import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RED_FLAG_RULES, detectRedFlags } from '../src/triage/redFlags.ts';

/**
 * The safety net for the safety net. Every rule in RED_FLAG_RULES must have a
 * positive case here — see the coverage test at the bottom, which fails the
 * build if a rule is added without one.
 */

const MUST_FIRE: Record<string, string[]> = {
  'cardiac.chest_pain': [
    'I have really bad chest pain and I feel sweaty',
    'there is a crushing chest pressure',
    'i think im having a heart attack',
  ],
  'cardiac.radiating_pain': ['the pain is radiating down my left arm'],
  'respiratory.severe': ["I can't breathe properly", 'my dad is gasping for air'],
  'neuro.stroke': ['her face is drooping and her speech is slurred', 'sudden numbness on one side'],
  'neuro.head_injury': ['he had a bad head injury this morning'],
  'neuro.consciousness': ['my mother passed out and is unresponsive', 'she had a seizure'],
  'trauma.bleeding': ["the cut is bleeding and it won't stop", 'I am vomiting blood'],
  'allergy.anaphylaxis': ['my throat is closing after eating peanuts'],
  'mental_health.self_harm': ['I have been having suicidal thoughts', 'I want to kill myself'],
  'toxic.poisoning': ['my son swallowed bleach', 'I took too many pills'],
  'obstetric.emergency': ['I am pregnant and bleeding heavily'],
  'infection.sepsis': ['stiff neck and fever with a rash'],
  'paediatric.infant_fever': ['my newborn has a fever'],
  'abdomen.acute': ['severe abdominal pain since last night'],
  'generic.emergency_language': ['this is an emergency, please help'],
};

describe('detectRedFlags — emergencies', () => {
  for (const [ruleId, messages] of Object.entries(MUST_FIRE)) {
    for (const message of messages) {
      it(`fires ${ruleId} for: "${message}"`, () => {
        const result = detectRedFlags(message);
        assert.equal(result.isEmergency, true, 'expected an emergency');
        assert.ok(
          result.matches.some((m) => m.ruleId === ruleId),
          `expected rule ${ruleId}, got ${result.matches.map((m) => m.ruleId).join(', ') || 'none'}`,
        );
      });
    }
  }
});

describe('detectRedFlags — everyday symptoms must NOT fire', () => {
  const SAFE = [
    'I have a sore throat and a runny nose for two days',
    'itchy rash on my arm since yesterday',
    'my knee hurts when I climb stairs',
    'I need a dental checkup and cleaning',
    'been feeling tired and low on energy lately',
    'blurry vision when reading small text',
    'I get heartburn after spicy food',
    'looking for a paediatrician for my daughter for a routine vaccination',
    'mild headache in the afternoons',
    'I want to check my blood sugar levels',
    'my ankle is a bit swollen after a long walk',
    'dandruff and hair fall',
  ];

  for (const message of SAFE) {
    it(`stays calm for: "${message}"`, () => {
      const result = detectRedFlags(message);
      assert.equal(
        result.isEmergency,
        false,
        `false positive from: ${result.matches.map((m) => `${m.ruleId}("${m.matchedText}")`).join(', ')}`,
      );
    });
  }
});

describe('detectRedFlags — negation handling', () => {
  const NEGATED = [
    'I have a cough but no chest pain',
    'headache, not a seizure, just a headache',
    'the doctor said it was not a stroke',
    'sore throat without difficulty breathing',
  ];

  for (const message of NEGATED) {
    it(`suppresses negated mention: "${message}"`, () => {
      assert.equal(detectRedFlags(message).isEmergency, false);
    });
  }
});

describe('detectRedFlags — suppression guards', () => {
  it('does not treat "emergency contact" as an emergency', () => {
    assert.equal(detectRedFlags('what is your emergency contact number?').isEmergency, false);
  });

  it('does not treat "emergency dentist" as an emergency', () => {
    assert.equal(detectRedFlags('I am looking for an emergency dentist').isEmergency, false);
  });
});

describe('detectRedFlags — multiple concerns', () => {
  it('reports every rule that fires', () => {
    const result = detectRedFlags('chest pain and I cannot breathe');
    assert.equal(result.isEmergency, true);
    const ids = result.matches.map((m) => m.ruleId);
    assert.ok(ids.includes('cardiac.chest_pain'));
    assert.ok(ids.includes('respiratory.severe'));
  });

  it('records the phrase that matched, for audit', () => {
    const result = detectRedFlags('I have severe chest pain');
    assert.ok(result.matches[0]?.matchedText.includes('chest pain'));
  });
});

describe('rule coverage', () => {
  it('every rule has at least one positive test case', () => {
    const tested = new Set(Object.keys(MUST_FIRE));
    const untested = RED_FLAG_RULES.filter((rule) => !tested.has(rule.id)).map((r) => r.id);
    assert.deepEqual(untested, [], `rules without a test case: ${untested.join(', ')}`);
  });

  it('every rule id is unique', () => {
    const ids = RED_FLAG_RULES.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
