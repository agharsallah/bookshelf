import { describe, expect, it } from 'vitest';
import type { RunLogEvent } from '../../lib/api/types/jobs';
import { logEntries } from './runLog';

const at = '2026-10-03T19:05:17Z';
const ev = (type: string, fields: Record<string, unknown> = {}): RunLogEvent => ({ at, attempt: 1, type, ...fields });

describe('logEntries', () => {
  it('joins the streamed pieces of one reply and keeps thinking apart from the text', () => {
    const entries = logEntries([ev('call', { call: 1, tier: 'distil', prompt: 'P', prompt_chars: 1 }), ev('thinking', { text: 'Let me ' }), ev('text', { text: '{"a"' }), ev('text', { text: ': 1}' })]);

    expect(entries.map((e) => e.kind)).toEqual(['call', 'output']);
    expect(entries[1]).toMatchObject({ text: '{"a": 1}', thinking: 'Let me ' });
  });

  it('starts a new output after any other event, so a retry streams on its own', () => {
    const entries = logEntries([ev('text', { text: 'first' }), ev('rejected', { problems: ['bad'], retrying: true }), ev('text', { text: 'second' })]);
    expect(entries.map((e) => (e.kind === 'output' ? e.text : e.kind))).toEqual(['first', 'line', 'second']);
  });

  it('shows the reply the skill returned, or the error of a failed call', () => {
    const [ok, failed] = logEntries([
      ev('reply', { ok: true, text: '{"title": "x"}', model: 'sonnet', duration_ms: 30000, tokens: 900 }),
      ev('reply', { ok: false, error: 'claude timed out after 900s' }),
    ]);
    expect(ok).toMatchObject({ kind: 'reply', ok: true, text: '{"title": "x"}', summary: 'Reply · sonnet · 30 s · 900 tokens' });
    expect(failed).toMatchObject({ kind: 'reply', ok: false, text: 'claude timed out after 900s', summary: 'Call failed' });
  });

  it('says how an attempt ended, in words, with why when it failed', () => {
    const lines = logEntries([ev('finished', { state: 'done', duration_ms: 64000 }), ev('finished', { state: 'queued', error: 'RuntimeError: boom' }), ev('finished', { state: 'failed', error: 'schema violation' })]);
    expect(lines.map((e) => (e.kind === 'line' ? [e.tone, e.text, e.detail] : null))).toEqual([
      ['good', 'Finished in 1 min 04 s', undefined],
      ['warn', 'Failed; it will be retried', 'RuntimeError: boom'],
      ['bad', 'Failed for good', 'schema violation'],
    ]);
  });

  it('turns a usage warning into a share of the limit', () => {
    const [line] = logEntries([ev('limit', { status: 'allowed_warning', window: 'seven_day', utilization: 0.9 })]);
    expect(line).toMatchObject({ tone: 'warn', text: '90% of the seven day limit used' });
  });
});
