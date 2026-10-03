/**
 * A job's run log (`GET /jobs/{id}/log`) as entries a reader can follow: the attempt
 * starting, each model call with the prompt it sent, the model's output as it streamed
 * (pieces joined), tool use, the reply the skill returned or its error, the schema gate's
 * verdict, usage warnings, and how the attempt ended. Pure: the view only draws it.
 */
import type { JobState, RunLogEvent } from '../../lib/api/types/jobs';
import { formatDuration } from '../../lib/jobs/progress';

export type Tone = 'plain' | 'good' | 'bad' | 'warn' | 'quiet';

export type LogEntry =
  | { kind: 'line'; key: string; at: string; tone: Tone; text: string; detail?: string }
  | { kind: 'call'; key: string; at: string; call: number; tier: string; prompt: string; promptChars: number }
  | { kind: 'output'; key: string; at: string; text: string; thinking: string }
  | { kind: 'reply'; key: string; at: string; ok: boolean; text: string; summary: string };

const str = (value: unknown): string => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);

const FINISHED: Partial<Record<JobState, [Tone, string]>> = {
  done: ['good', 'Finished'],
  skipped: ['quiet', 'Skipped'],
  failed: ['bad', 'Failed for good'],
  queued: ['warn', 'Failed; it will be retried'],
};

function finished(event: RunLogEvent, key: string): LogEntry {
  const state = str(event.state) as JobState;
  const [tone, words] = FINISHED[state] ?? ['plain', `Ended ${state}`];
  const took = num(event.duration_ms);
  const reason = str(event.text) || str(event.error);
  return { kind: 'line', key, at: event.at, tone, text: `${words}${took !== null && state === 'done' ? ` in ${formatDuration(took)}` : ''}`, detail: reason || undefined };
}

function limit(event: RunLogEvent, key: string): LogEntry {
  const used = num(event.utilization);
  const window = str(event.window).replaceAll('_', ' ');
  const share = used !== null ? `${Math.round(used * 100)}% of the ${window || 'usage'} limit used` : `usage limit: ${str(event.status)}`;
  return { kind: 'line', key, at: event.at, tone: 'warn', text: share.charAt(0).toUpperCase() + share.slice(1) };
}

/** One entry per event, except streamed pieces, which join into one output per call. */
export function logEntries(events: readonly RunLogEvent[]): LogEntry[] {
  const entries: LogEntry[] = [];
  let output: Extract<LogEntry, { kind: 'output' }> | null = null;
  events.forEach((event, i) => {
    const key = `${i}`;
    if (event.type === 'text' || event.type === 'thinking') {
      if (!output) {
        output = { kind: 'output', key, at: event.at, text: '', thinking: '' };
        entries.push(output);
      }
      if (event.type === 'text') output.text += str(event.text);
      else output.thinking += str(event.text);
      return;
    }
    output = null;
    const line = (tone: Tone, text: string, detail?: string) => entries.push({ kind: 'line', key, at: event.at, tone, text, detail });
    switch (event.type) {
      case 'started':
        line('plain', `Attempt ${event.attempt} started`, str(event.worker) || undefined);
        break;
      case 'session':
        line('quiet', `Session open on ${str(event.model) || 'the model'}`);
        break;
      case 'status':
        line('quiet', `Model: ${str(event.text)}`);
        break;
      case 'call':
        entries.push({ kind: 'call', key, at: event.at, call: num(event.call) ?? 1, tier: str(event.tier), prompt: str(event.prompt), promptChars: num(event.prompt_chars) ?? 0 });
        break;
      case 'tool':
        line('plain', `Tool: ${str(event.name)}`, str(event.input) || undefined);
        break;
      case 'tool_result':
        line(event.error ? 'bad' : 'quiet', event.error ? 'Tool failed' : 'Tool result', str(event.text) || undefined);
        break;
      case 'reply': {
        const ok = event.ok === true;
        const took = num(event.duration_ms);
        const bits = [ok ? 'Reply' : 'Call failed', str(event.model), took !== null ? formatDuration(took) : '', num(event.tokens) !== null ? `${num(event.tokens)} tokens` : ''];
        entries.push({ kind: 'reply', key, at: event.at, ok, text: ok ? str(event.text) : str(event.error), summary: bits.filter(Boolean).join(' · ') });
        break;
      }
      case 'rejected':
        line('bad', event.retrying ? 'Reply rejected; asking again' : 'Reply rejected again', list(event.problems).join('\n') || undefined);
        break;
      case 'repaired':
        line('quiet', 'Reply shape mended', list(event.fixes).join('\n') || undefined);
        break;
      case 'accepted':
        line('good', event.retried ? 'Reply accepted on the second try' : 'Reply accepted');
        break;
      case 'limit':
        entries.push(limit(event, key));
        break;
      case 'stderr':
        line('warn', 'The CLI wrote to stderr', str(event.text));
        break;
      case 'released':
        line('warn', 'Stopped and handed back to the queue', str(event.text) || undefined);
        break;
      case 'finished':
        entries.push(finished(event, key));
        break;
      case 'truncated':
        line('warn', str(event.text) || 'The log is full.');
        break;
      default:
        line('quiet', event.type);
    }
  });
  return entries;
}
