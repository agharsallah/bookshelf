/**
 * Version diff (§12): render blocks → a normalized plain-text rendering → word diff.
 *
 * One line per block (or list item / table row). Cites are kept as `[anchor]` tokens:
 * a moved or dropped citation is a change a reviewer must see.
 */
import { diffWordsWithSpace } from 'diff';
import { TONES } from '../../blocks/callout-tones';
import type { RenderBlock, Span } from '../../../lib/contract';

function spanText(spans: readonly Span[]): string {
  return spans
    .map((s) => [s.text.trim(), ...s.cites.map((c) => `[${c}]`)].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ');
}

const cites = (anchors: readonly string[]) => anchors.map((c) => `[${c}]`).join(' ');
const line = (...parts: string[]) => parts.filter(Boolean).join(' ');

function blockLines(block: RenderBlock): string[] {
  switch (block.type) {
    case 'heading':
      return [`${'#'.repeat(block.level)} ${block.text}`];
    case 'paragraph':
      return [spanText(block.spans)];
    case 'bullets':
      return block.items.map((item) => `• ${spanText(item)}`);
    case 'steps':
      return block.items.map((item, i) => `${i + 1}. ${spanText(item)}`);
    case 'callout':
      return [line(`[${TONES[block.tone].label}]`, block.title ?? '', spanText(block.spans))];
    case 'definition':
      return [`${block.term}: ${spanText(block.spans)}`];
    case 'table':
      return [
        ...(block.caption ? [`Table: ${block.caption}`] : []),
        block.header.join(' | '),
        ...block.rows.map((row) => row.map((cell) => spanText([cell])).join(' | ')),
      ];
    case 'quote':
      return [line(`“${block.text}”`, block.attribution ? `— ${block.attribution}` : '', block.page ? `(p. ${block.page})` : '', cites(block.cites))];
    case 'code':
      return [line(`\`\`\`${block.language ?? ''}`), block.text, line('```', cites(block.cites))];
    case 'math':
      return [line(`$${block.latex}$`, spanText(block.meaning ?? []), cites(block.cites))];
    case 'chart':
      return [
        line(`Chart (${block.kind}):`, block.title ?? '', cites(block.cites)),
        ...block.series.map((s) => `${s.name}: ${s.values.map((v) => (v === null ? '–' : String(v))).join(', ')}`),
      ];
    case 'diagram':
      return [
        line('Diagram:', cites(block.cites)),
        ...block.edges.map((e) => line(e.from, '→', e.to, e.label ? `(${e.label})` : '')),
      ];
    default:
      return [JSON.stringify(block)];
  }
}

/** The text a diff compares: stable, one block per paragraph, whitespace collapsed. */
export function normalizeBlocks(blocks: readonly RenderBlock[]): string {
  return blocks
    .flatMap(blockLines)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export type SegmentKind = 'same' | 'ins' | 'del';

export interface DiffSegment {
  kind: SegmentKind;
  text: string;
}

/** Word-level segments from `before` to `after`, adjacent runs of one kind merged. */
export function diffSegments(before: string, after: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  for (const change of diffWordsWithSpace(before, after)) {
    const kind: SegmentKind = change.added ? 'ins' : change.removed ? 'del' : 'same';
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += change.value;
    else segments.push({ kind, text: change.value });
  }
  return segments;
}

/** Side-by-side: the old column keeps `same` + `del`, the new one `same` + `ins`. */
export function splitSides(segments: readonly DiffSegment[]): { before: DiffSegment[]; after: DiffSegment[] } {
  return {
    before: segments.filter((s) => s.kind !== 'ins'),
    after: segments.filter((s) => s.kind !== 'del'),
  };
}

export interface DiffStats {
  inserted: number;
  deleted: number;
}

/** Words added and removed, for the summary line. */
export function diffStats(segments: readonly DiffSegment[]): DiffStats {
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  return segments.reduce(
    (acc, s) => ({
      inserted: acc.inserted + (s.kind === 'ins' ? words(s.text) : 0),
      deleted: acc.deleted + (s.kind === 'del' ? words(s.text) : 0),
    }),
    { inserted: 0, deleted: 0 },
  );
}
