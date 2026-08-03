import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyByRules } from '../src/nlu/symptomRules.ts';

describe('classifyByRules', () => {
  const CASES: [message: string, expected: string][] = [
    ['itchy red rash on my forearm that keeps spreading', 'dermatology'],
    ['my tooth has been aching for three days', 'dentistry'],
    ['blurry vision and my eyes water a lot', 'ophthalmology'],
    ['knee pain when I climb stairs after a sports injury', 'orthopaedics'],
    ['constant heartburn and acid reflux after meals', 'gastroenterology'],
    ['I get panic attacks and my anxiety is unmanageable', 'psychiatry'],
    ['ringing in my ears and some hearing loss', 'ent'],
    ['irregular periods and I was told I might have pcos', 'gynaecology'],
    ['my thyroid results were off and my blood sugar is high', 'endocrinology'],
    ['wheezing at night, my asthma is acting up', 'pulmonology'],
    ['burning when I pee, probably a uti', 'urology'],
    ['heart palpitations and my blood pressure is high', 'cardiology'],
    ['severe migraines with vertigo', 'neurology'],
  ];

  for (const [message, expected] of CASES) {
    it(`routes "${message}" to ${expected}`, () => {
      const result = classifyByRules(message);
      assert.equal(result.specialty, expected);
      assert.ok(result.confidence > 0, 'expected non-zero confidence');
    });
  }

  it('falls back to general practice for vague input', () => {
    const result = classifyByRules('I just feel a bit off today');
    assert.equal(result.specialty, 'general_practice');
  });

  it('returns low confidence when nothing matches at all', () => {
    const result = classifyByRules('hello there');
    assert.equal(result.specialty, 'general_practice');
    assert.ok(result.confidence < 0.45, 'unmatched input should not look confident');
  });

  it('reports lower confidence for genuinely ambiguous input', () => {
    const clear = classifyByRules('severe toothache and bleeding gums, need a root canal');
    const ambiguous = classifyByRules('rash and knee pain and toothache');
    assert.ok(
      clear.confidence > ambiguous.confidence,
      `expected ${clear.confidence} > ${ambiguous.confidence}`,
    );
  });

  it('surfaces the matched keywords for explainability', () => {
    const result = classifyByRules('I have psoriasis and eczema');
    assert.ok(result.matchedSymptoms.includes('psoriasis'));
    assert.ok(result.matchedSymptoms.includes('eczema'));
  });
});
