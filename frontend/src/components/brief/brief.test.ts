import { describe, expect, it } from 'vitest';
import example from '../../../../skills/write-brief/example.json';
import { parseBrief } from './brief';

describe('parseBrief', () => {
  it('reads the write-brief example in its fixed order with its read-next pointers', () => {
    const brief = parseBrief(example as Record<string, unknown>);
    expect(brief?.sections.map((s) => s.key)).toEqual(['thesis', 'ideas', 'structure', 'changes', 'weaknesses', 'read_next']);
    expect(brief?.readNext.map((r) => r.slug)).toEqual(['meadows-systems']);
    expect(brief?.sections[1]?.blocks[0]?.type).toBe('bullets');
  });

  it('puts sections back in the canonical order, keeps the first of duplicates, fills missing titles', () => {
    const brief = parseBrief({
      sections: [
        { key: 'changes', title: '', blocks: [] },
        { key: 'thesis', title: 'In short', blocks: [] },
        { key: 'thesis', title: 'Again', blocks: [] },
        { key: 'unknown', title: 'x', blocks: [] },
      ],
    });
    expect(brief?.sections.map((s) => [s.key, s.title])).toEqual([
      ['thesis', 'In short'],
      ['changes', 'What it changes'],
    ]);
    expect(brief?.readNext).toEqual([]);
  });

  it('is null for a body that is not a brief', () => {
    expect(parseBrief({ blocks: [] })).toBeNull();
  });

  it('drops malformed read-next entries and reason spans', () => {
    const brief = parseBrief({
      sections: [{ key: 'thesis', title: 'T', blocks: [] }],
      read_next: [{ slug: 'a', reason: [{ text: 'why', cites: [] }, { nope: 1 }] }, { reason: [] }],
    });
    expect(brief?.readNext).toEqual([{ slug: 'a', reason: [{ text: 'why', cites: [] }] }]);
  });
});
