import { describe, expect, it } from 'vitest';
import { artifact } from './fixtures';
import { deriveGates } from './gates';

const distil = { grounding_min: 0.9, compression: [0.1, 0.25] as [number, number], max_words: null };

describe('deriveGates', () => {
  it('passes a grounded draft inside its compression band', () => {
    const gates = deriveGates(artifact(), distil);
    expect(gates).toMatchObject({
      grounding: { score: 1, min: 0.9, passed: true },
      compression: { ratio: 0.18, band: [0.1, 0.25], status: 'within' },
      flags: [],
      passesAll: true,
    });
  });

  it.each([
    [0.9, true],
    [0.89, false],
  ])('grounding %s against the 0.9 threshold passes: %s', (score, passed) => {
    const gates = deriveGates(artifact({ gates: { grounding: score, flags: [] } }), distil);
    expect(gates.grounding?.passed).toBe(passed);
    expect(gates.passesAll).toBe(passed);
  });

  it.each([
    [0.09, 'low'],
    [0.1, 'within'],
    [0.25, 'within'],
    [0.26, 'high'],
  ])('compression %s is %s the band', (ratio, status) => {
    expect(deriveGates(artifact({ gates: { compression: ratio } }), distil).compression?.status).toBe(status);
  });

  it('uses the default 0.9 threshold when the skill is unknown', () => {
    expect(deriveGates(artifact({ gates: { grounding: 0.85 } })).grounding).toEqual({ score: 0.85, min: 0.9, passed: false });
  });

  it('turns stored flags into labelled badges, leaving meter-drawn flags out', () => {
    const gates = deriveGates(
      artifact({ gates: { grounding: 0.5, flags: ['grounding_below_min', 'low_confidence', 'duplicate_of:ch01/s02'], schema_retry: true } }),
      distil,
    );
    expect(gates.flags.map((f) => [f.label, f.tone])).toEqual([
      ['Low confidence', 'fail'],
      ['Repeats ch01/s02', 'warn'],
      ['Schema retry', 'info'],
    ]);
  });

  it('a schema retry alone does not block bulk approval', () => {
    expect(deriveGates(artifact({ gates: { grounding: 1, schema_retry: true } }), distil).passesAll).toBe(true);
  });

  it('shows mechanical shape repairs as an info badge that does not block bulk approval', () => {
    const gates = deriveGates(artifact({ gates: { grounding: 1, repairs: ['paragraph: text → spans'] } }), distil);
    expect(gates.flags).toEqual([
      expect.objectContaining({ key: 'repairs', label: 'Shape repaired', tone: 'info' }),
    ]);
    expect(gates.flags[0]?.detail).toContain('paragraph: text → spans');
    expect(gates.passesAll).toBe(true);
  });

  it('marks human artifacts as bypassing grounding and compression', () => {
    const gates = deriveGates(artifact({ origin: 'human', gates: { grounding: null, compression: null, words: 40 } }));
    expect(gates).toMatchObject({ bypassed: true, grounding: null, compression: null, words: 40, passesAll: true });
  });
});
