/**
 * Reading untrusted artifact JSON: every accessor tolerates a missing or mistyped field,
 * so a malformed body renders less rather than throwing. Shared by the body adapters
 * (`adapters.ts`) and the paper views (`components/papers/bodies.ts`).
 */
import type { RenderBlock, Span, Spans } from '../../../lib/contract';

export type Json = Record<string, unknown>;

export const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === 'string');

export function spans(v: unknown): Spans {
  return list(v).filter(isRecord).map((s) => ({
    text: str(s.text),
    cites: strings(s.cites),
    ...(typeof s.mark === 'string' ? { mark: s.mark as Span['mark'] } : {}),
  }));
}

export function blocks(v: unknown): RenderBlock[] {
  return list(v).filter(isRecord) as unknown as RenderBlock[];
}

const SYNTHETIC = new WeakSet<Span>();

/** A span an adapter wrote for structure (a heading, a name), not a claim to ground:
 * never counted or marked as uncited. */
export function synthetic(text: string, mark?: Span['mark']): Span {
  const span: Span = mark ? { text, cites: [], mark } : { text, cites: [] };
  SYNTHETIC.add(span);
  return span;
}

export function isSynthetic(span: Span): boolean {
  return SYNTHETIC.has(span);
}
