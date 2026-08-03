import { config } from '../config.js';
import { logger } from '../logger.js';

export interface GenerateOptions {
  system?: string;
  /** Ollama-native structured output. Pass a JSON Schema object. */
  format?: 'json' | Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export class OllamaUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Ollama unavailable at ${config.llm.baseUrl}: ${String(cause)}`);
    this.name = 'OllamaUnavailableError';
  }
}

/**
 * Thin client over Ollama's /api/generate. Deliberately not streaming — every
 * caller here wants a complete structured answer, and the callers all have a
 * deterministic fallback if this throws.
 */
export async function generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
  if (!config.llm.enabled) {
    throw new OllamaUnavailableError('LLM_ENABLED=false');
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? config.llm.timeoutMs,
  );

  try {
    const response = await fetch(`${config.llm.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.llm.model,
        prompt,
        system: options.system,
        format: options.format,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 512,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => '')}`);
    }

    const body = (await response.json()) as { response?: string };
    return body.response ?? '';
  } catch (error) {
    throw new OllamaUnavailableError(error);
  } finally {
    clearTimeout(timeout);
  }
}

/** True when the daemon answers and the configured model is present. */
export async function healthCheck(): Promise<{ ok: boolean; detail: string }> {
  if (!config.llm.enabled) return { ok: false, detail: 'disabled by config' };
  try {
    const response = await fetch(`${config.llm.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };

    const body = (await response.json()) as { models?: { name: string }[] };
    const names = (body.models ?? []).map((m) => m.name);
    // Ollama reports "llama3.1:8b"; a config value of "llama3.1" should match.
    const present = names.some((n) => n === config.llm.model || n.startsWith(`${config.llm.model}:`));
    return present
      ? { ok: true, detail: config.llm.model }
      : { ok: false, detail: `model ${config.llm.model} not pulled (have: ${names.join(', ') || 'none'})` };
  } catch (error) {
    logger.debug({ err: error }, 'ollama health check failed');
    return { ok: false, detail: String(error) };
  }
}
