/**
 * The extraction artifacts' bodies, read tolerantly and flattened onto render blocks for
 * the review queue (`adaptBody`):
 *
 * - `claim_set` (extract-claims): `claims[{key, text, kind, strength, cites}]`.
 * - `results_table` (extract-results): `rows[{method, dataset, metric, value, unit,
 *   higher_is_better, is_proposed, setting?, cites}]`.
 * - `citation_intents` (classify-citations): `citations[{ordinal, intent, cites}]`.
 *
 * Shapes: skills/<name>/schema.json.
 */
import { CITATION_INTENTS, CLAIM_KINDS, CLAIM_STRENGTHS, type CitationIntent, type ClaimKind, type ClaimStrength } from '../../lib/api/types/papers';
import type { RenderBlock, Span } from '../../lib/contract';
import { isRecord, list, str, strings, synthetic } from '../review/body/read';
import { CONTRIBUTION_LABELS } from './bodies';
import { INTENT_LABELS } from './labels';
import { formatValue } from './results';
import { STRENGTH_LABELS } from './study-labels';
import { bullets, section } from './study-bodies';

const inList =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    (values as readonly unknown[]).includes(v);

const rowsOf = (raw: unknown, key: string) => list(isRecord(raw) ? raw[key] : null).filter(isRecord);

// ── Claims ─────────────────────────────────────────────────────────────────────────

export interface DraftClaim {
  key: string;
  text: string;
  kind: ClaimKind;
  strength: ClaimStrength;
  cites: string[];
}

const isKind = inList(CLAIM_KINDS);
const isStrength = inList(CLAIM_STRENGTHS);

export function parseClaimSet(raw: unknown): DraftClaim[] {
  return rowsOf(raw, 'claims')
    .map((c) => ({
      key: str(c.key),
      text: str(c.text),
      kind: isKind(c.kind) ? c.kind : 'position',
      strength: isStrength(c.strength) ? c.strength : 'argued',
      cites: strings(c.cites),
    }))
    .filter((c) => c.text !== '');
}

export function claimSetBlocks(claims: readonly DraftClaim[]): RenderBlock[] {
  return bullets(
    claims.map((c) => [
      synthetic(`${c.key} · ${CONTRIBUTION_LABELS[c.kind]}, ${STRENGTH_LABELS[c.strength].name.toLowerCase()}: `, 'strong'),
      { text: c.text, cites: c.cites },
    ]),
  );
}

// ── Results ────────────────────────────────────────────────────────────────────────

export interface ResultRow {
  method: string;
  dataset: string;
  metric: string;
  value: number;
  unit: string | null;
  higherIsBetter: boolean;
  isProposed: boolean;
  setting: string | null;
  cites: string[];
}

export function parseResults(raw: unknown): ResultRow[] {
  return rowsOf(raw, 'rows')
    .filter((r) => typeof r.value === 'number' && Number.isFinite(r.value))
    .map((r) => ({
      method: str(r.method),
      dataset: str(r.dataset),
      metric: str(r.metric),
      value: r.value as number,
      unit: str(r.unit) || null,
      higherIsBetter: r.higher_is_better !== false,
      isProposed: r.is_proposed === true,
      setting: str(r.setting) || null,
      cites: strings(r.cites),
    }))
    .filter((r) => r.method !== '' && r.metric !== '');
}

export function resultsBlocks(rows: readonly ResultRow[]): RenderBlock[] {
  if (rows.length === 0) return [];
  const cell = (text: string): Span => synthetic(text);
  return [
    {
      type: 'table',
      header: ['Method', 'Dataset', 'Metric', 'Value', 'Setting'],
      rows: rows.map((r) => [
        cell(r.isProposed ? `${r.method} (proposed)` : r.method),
        cell(r.dataset),
        cell(`${r.metric}${r.higherIsBetter ? ' ↑' : ' ↓'}`),
        { text: formatValue(r.value, r.unit), cites: r.cites },
        cell(r.setting ?? ''),
      ]),
    },
  ];
}

// ── Citation intents ───────────────────────────────────────────────────────────────

export interface IntentVerdict {
  ordinal: number;
  intent: CitationIntent;
  cites: string[];
}

const isIntent = inList(CITATION_INTENTS);

export function parseIntents(raw: unknown): IntentVerdict[] {
  return rowsOf(raw, 'citations')
    .flatMap((c) => (typeof c.ordinal === 'number' && isIntent(c.intent) ? [{ ordinal: c.ordinal, intent: c.intent, cites: strings(c.cites) }] : []))
    .sort((a, b) => a.ordinal - b.ordinal);
}

export function intentsBlocks(verdicts: readonly IntentVerdict[]): RenderBlock[] {
  return section(
    'Why each reference is cited',
    bullets(verdicts.map((v) => [synthetic(`[${v.ordinal}] `, 'strong'), { text: INTENT_LABELS[v.intent], cites: v.cites }])),
  );
}
