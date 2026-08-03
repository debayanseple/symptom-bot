import { pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Sentence-Transformers running in-process via transformers.js. Keeps the
 * whole system single-runtime and $0: the model (~23 MB for MiniLM) downloads
 * once to a local cache and then runs on CPU with no network and no per-call
 * cost.
 */
let extractor: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= (async () => {
    logger.info(`loading embedding model ${config.rag.model} (first run downloads it)`);
    const instance = await pipeline('feature-extraction', config.rag.model);
    logger.info('embedding model ready');
    return instance;
  })();
  return extractor;
}

/**
 * Mean-pooled, L2-normalised sentence embeddings — the standard recipe for
 * all-MiniLM-L6-v2. Normalising here means pgvector's cosine distance and a
 * plain dot product agree, so either operator gives the same ranking.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const model = await getExtractor();
  const output = await model(texts, { pooling: 'mean', normalize: true });
  const data = output.tolist() as number[][];

  const first = data[0];
  if (first && first.length !== config.rag.dim) {
    throw new Error(
      `Embedding model returned ${first.length} dimensions but EMBEDDING_DIM is ${config.rag.dim}. ` +
        'Update EMBEDDING_DIM and the vector(N) column width in the migration to match.',
    );
  }

  return data;
}

export async function embedOne(text: string): Promise<number[]> {
  const [vector] = await embed([text]);
  if (!vector) throw new Error('embedding failed to produce a vector');
  return vector;
}

/** pgvector's text input format: '[0.1,0.2,...]'. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/** Frees the model between batch jobs; the server keeps it warm instead. */
export async function disposeEmbedder(): Promise<void> {
  if (!extractor) return;
  const instance = await extractor;
  await instance.dispose();
  extractor = null;
}
