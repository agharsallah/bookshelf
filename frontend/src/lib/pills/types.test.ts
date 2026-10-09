/**
 * The TS mirror against `contracts/pill.schema.json`: the kind set and each body's fields
 * must match, and every example the backend publishes must be a kind we render.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_FIXTURES, BODIES, makePill } from './testing/fixtures';
import { isActive, mediaUrl, PILL_KINDS, type PillKind } from './types';

const CONTRACTS = resolve(__dirname, '../../../../contracts');
const schema = JSON.parse(readFileSync(resolve(CONTRACTS, 'pill.schema.json'), 'utf8')) as {
  $defs: Record<string, { enum?: string[]; properties?: Record<string, unknown>; required?: string[] }>;
};

/** The body definition the schema assigns to each kind. */
const BODY_DEF: Record<PillKind, string> = {
  insight: 'insightBody',
  remember: 'spansBody',
  antipattern: 'spansBody',
  quote: 'quoteBody',
  definition: 'definitionBody',
  number: 'numberBody',
  figure: 'figureBody',
  diagram: 'diagramBody',
  quiz: 'quizBody',
  flip: 'flipBody',
  claim: 'claimBody',
  math: 'mathBody',
  connection: 'connectionBody',
  listen: 'listenBody',
  hook: 'hookBody',
  review: 'reviewBody',
};

describe('the pill contract', () => {
  it('has the same closed set of kinds', () => {
    expect([...PILL_KINDS].sort()).toEqual([...(schema.$defs.kind?.enum ?? [])].sort());
  });

  it.each(PILL_KINDS)('fixture body of %s uses only schema fields and has every required one', (kind) => {
    const def = schema.$defs[BODY_DEF[kind]]!;
    const fields = Object.keys(BODIES[kind]);
    expect(fields.every((f) => f in (def.properties ?? {}))).toBe(true);
    expect((def.required ?? []).every((f) => fields.includes(f))).toBe(true);
  });

  it('has the same top-level pill fields', () => {
    const required = schema.$defs.pill?.required ?? [];
    expect(Object.keys(makePill('insight')).sort()).toEqual([...required].sort());
  });

  const examples = resolve(CONTRACTS, 'pill.examples.json');
  it.runIf(existsSync(examples))('has a published example of every kind, with the fields our fixtures use', () => {
    const raw = JSON.parse(readFileSync(examples, 'utf8')) as { examples: Record<string, { kind: string; body: object }> };
    const list = Object.values(raw.examples);
    expect(list.map((e) => e.kind).sort()).toEqual([...PILL_KINDS].sort());
    for (const example of list) {
      const def = schema.$defs[BODY_DEF[example.kind as PillKind]]!;
      expect(Object.keys(example.body).every((f) => f in (def.properties ?? {}))).toBe(true);
      expect(Object.keys(example).sort()).toEqual(Object.keys(makePill('insight')).sort());
    }
  });
});

/**
 * The field names of a value, all the way down (an array: its first object's). Pills are
 * left opaque: the contract tests above cover them.
 */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) {
    const first: unknown = value.find((v) => v && typeof v === 'object');
    return first ? [shape(first)] : [];
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, k === 'pills' ? 'pills' : shape(v)]));
  }
  return 'value';
}

describe('the pills API bodies', () => {
  const api = (JSON.parse(readFileSync(resolve(CONTRACTS, 'pill.examples.json'), 'utf8')) as { api: Record<string, unknown> }).api;

  it('has a typed fixture for every response the backend publishes', () => {
    expect(Object.keys(API_FIXTURES).sort()).toEqual(Object.keys(api).sort());
  });

  it.each(Object.keys(API_FIXTURES))('%s has the fields the backend sends', (name) => {
    expect(shape(API_FIXTURES[name as keyof typeof API_FIXTURES])).toEqual(shape(api[name]));
  });
});

describe('helpers', () => {
  it('counts quiz, flip, review and math with a try-it as active', () => {
    expect(isActive(makePill('quiz'))).toBe(true);
    expect(isActive(makePill('math'))).toBe(true);
    expect(isActive(makePill('math', { body: { ...BODIES.math, try_it: null } }))).toBe(false);
    expect(isActive(makePill('insight'))).toBe(false);
  });

  it('puts relative media under the API base and leaves absolute URLs alone', () => {
    expect(mediaUrl('/api', 'media/x.png')).toBe('/api/media/x.png');
    expect(mediaUrl('/api/', '/static/x.png')).toBe('/static/x.png');
    expect(mediaUrl('/api', 'https://cdn.test/x.png')).toBe('https://cdn.test/x.png');
  });
});
