/**
 * What the distillation pane shows for one chapter, chosen from every artifact under
 * it: the best chapter distillation and summary, one note per section, and one
 * explanation per figure/table/code/math block. Each entry is reduced to render
 * blocks, so the pane renders everything with `<Blocks>`.
 */
import type { Artifact, ArtifactType } from '../../lib/api/types/artifacts';
import type { RenderBlock, Span } from '../../lib/contract';
import { EXPLANATION_TYPES, pickBest, pickBestUnder, type Chosen, type Standing } from '../../lib/documents/artifacts';

export interface PaneEntry {
  id: string;
  anchor: string;
  type: ArtifactType;
  standing: Standing;
  version: number;
  origin: Artifact['origin'];
  /** A heading for lists of entries (section title, figure caption). */
  title: string | null;
  blocks: RenderBlock[];
}

export interface Panes {
  distillation: PaneEntry | null;
  summary: PaneEntry | null;
  sections: PaneEntry[];
  figures: PaneEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSpan(value: unknown): value is Span {
  return isRecord(value) && typeof value.text === 'string' && Array.isArray(value.cites);
}

/** The render blocks of an artifact body, plus a takeaway span as an insight callout. */
export function bodyBlocks(body: Record<string, unknown>): RenderBlock[] {
  const blocks = Array.isArray(body.blocks) ? (body.blocks.filter(isRecord) as unknown as RenderBlock[]) : [];
  const takeaway = body.takeaway;
  if (isSpan(takeaway)) {
    return [...blocks, { type: 'callout', tone: 'insight', title: 'Takeaway', spans: [takeaway] }];
  }
  return blocks;
}

function entry(chosen: Chosen, title: string | null): PaneEntry {
  const { artifact } = chosen;
  return {
    id: artifact.id,
    anchor: artifact.anchor ?? '',
    type: artifact.type,
    standing: chosen.standing,
    version: artifact.version,
    origin: artifact.origin,
    title,
    blocks: bodyBlocks(artifact.body),
  };
}

const caption = (a: Artifact): string | null => (typeof a.body.caption === 'string' ? a.body.caption : null);

/** `headings` maps an anchor to its section heading or block caption, for entry titles. */
export function buildPanes(
  artifacts: readonly Artifact[],
  unit: string,
  headings: Readonly<Record<string, string>> = {},
): Panes {
  const one = (type: ArtifactType) => {
    const chosen = pickBest(artifacts, type, unit);
    return chosen ? entry(chosen, null) : null;
  };
  const figures = EXPLANATION_TYPES.flatMap((type) => pickBestUnder(artifacts, type, unit))
    .map((c) => entry(c, caption(c.artifact) ?? headings[c.artifact.anchor ?? ''] ?? null))
    .sort((a, b) => a.anchor.localeCompare(b.anchor, 'en', { numeric: true }));
  return {
    distillation: one('chapter_distillation'),
    summary: one('chapter_summary'),
    sections: pickBestUnder(artifacts, 'section_note', unit).map((c) => entry(c, headings[c.artifact.anchor ?? ''] ?? null)),
    figures,
  };
}

/** Every render-block list in the panes, for server-side `prepareBlocks`. */
export function paneEntries(panes: Panes): PaneEntry[] {
  return [panes.distillation, panes.summary, ...panes.sections, ...panes.figures].filter(
    (e): e is PaneEntry => e !== null,
  );
}
