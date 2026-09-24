import { describe, expect, it } from 'vitest';
import type { NodeKind, NodeMeta } from '../../lib/api/types/documents';
import { roleOf } from './semantics';

const node = (kind: NodeKind, text: string | null = null, meta: NodeMeta = {}) => ({ kind, text, meta });
const role = (kind: NodeKind, text: string | null = null, meta: NodeMeta = {}) => roleOf(node(kind, text, meta))?.role ?? null;

describe('roleOf', () => {
  it('reads quotes, figures, tables, formulas and code from the block kind', () => {
    expect(['quote', 'figure', 'table', 'math', 'code'].map((k) => role(k as NodeKind))).toEqual(['quote', 'figure', 'table', 'math', 'code']);
    expect(role('section', 'Why it lags')).toBeNull();
  });

  it('keeps an aside’s own label and maps it to a role', () => {
    expect(roleOf(node('aside', 'Say what you did.', { label: 'Key takeaways' }))).toEqual({ role: 'key', label: 'Key takeaways' });
    expect(role('aside', 'x', { label: 'Exercise 2.1' })).toBe('exercise');
    expect(role('aside', 'x', { label: 'Warning' })).toBe('warning');
    expect(role('aside', 'x', { label: 'Tip' })).toBe('tip');
    expect(role('aside', 'x', { label: 'Sidebar' })).toBe('note');
    expect(roleOf(node('aside', 'An unlabelled box.'))).toEqual({ role: 'note', label: 'Note' });
  });

  it('spots examples by how a paragraph opens', () => {
    expect(role('paragraph', 'For example, a queue that grows…')).toBe('example');
    expect(role('paragraph', 'For instance: the STAR answer.')).toBe('example');
    expect(role('paragraph', 'Example 4.2: a conflict story.')).toBe('example');
    expect(role('paragraph', 'e.g. the time you shipped late.')).toBe('example');
    expect(role('paragraph', 'Examples help, but stories stick.')).toBeNull();
  });

  it('spots labelled paragraphs and lists', () => {
    expect(role('paragraph', 'Tip: lead with the result.')).toBe('tip');
    expect(role('paragraph', 'Warning — never blame the team.')).toBe('warning');
    expect(role('list', 'Key points: one\ntwo')).toBe('key');
    expect(role('paragraph', 'Notes are kept verbatim.')).toBeNull();
  });

  it('treats a paragraph that is one quotation as a quote', () => {
    expect(role('paragraph', '“I owned the migration and cut the p95 by half.”')).toBe('quote');
    expect(role('paragraph', '"Slack is not waste." — Tom DeMarco')).toBe('quote');
    expect(role('paragraph', '“Slack” is what the author calls it, and he means it.')).toBeNull();
  });

  it('labels a code block captioned as an example an example', () => {
    expect(role('code', 'print(1)', { caption: 'Example 3.1 A retry loop' })).toBe('example');
    expect(role('code', 'print(1)', { caption: 'Listing 3.1 A retry loop' })).toBe('code');
  });
});
