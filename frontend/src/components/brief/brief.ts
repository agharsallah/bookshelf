/**
 * The book brief's fixed one-page shape (§9 "Format of a brief";
 * skills/write-brief/schema.json): six sections in a fixed order, then read-next
 * pointers into the shelf. Parsing is defensive so a malformed body renders what
 * it can instead of failing the page.
 */
import type { RenderBlock, Span } from '../../lib/contract';

export const BRIEF_KEYS = ['thesis', 'ideas', 'structure', 'changes', 'weaknesses', 'read_next'] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];

export const DEFAULT_TITLES: Record<BriefKey, string> = {
  thesis: 'Thesis',
  ideas: 'Load-bearing ideas',
  structure: 'How the argument is built',
  changes: 'What it changes',
  weaknesses: 'Where it is weak or dated',
  read_next: 'Read next',
};

export interface BriefSection {
  key: BriefKey;
  title: string;
  blocks: RenderBlock[];
}

export interface ReadNext {
  slug: string;
  reason: Span[];
}

/** A read-next pointer resolved against the shelf (title is null when the slug is gone). */
export interface ReadNextItem extends ReadNext {
  title: string | null;
  authors: string[];
}

export interface Brief {
  sections: BriefSection[];
  readNext: ReadNext[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isKey = (v: unknown): v is BriefKey => typeof v === 'string' && (BRIEF_KEYS as readonly string[]).includes(v);
const isSpan = (v: unknown): v is Span => isRecord(v) && typeof v.text === 'string' && Array.isArray(v.cites);

/** The brief in its canonical order; null when the body has no recognisable sections. */
export function parseBrief(body: Record<string, unknown>): Brief | null {
  const raw = Array.isArray(body.sections) ? body.sections.filter(isRecord) : [];
  const byKey = new Map<BriefKey, BriefSection>();
  for (const section of raw) {
    if (!isKey(section.key) || byKey.has(section.key)) continue;
    byKey.set(section.key, {
      key: section.key,
      title: typeof section.title === 'string' && section.title.trim() ? section.title : DEFAULT_TITLES[section.key],
      blocks: Array.isArray(section.blocks) ? (section.blocks.filter(isRecord) as unknown as RenderBlock[]) : [],
    });
  }
  if (byKey.size === 0) return null;
  const readNext = (Array.isArray(body.read_next) ? body.read_next.filter(isRecord) : [])
    .filter((r) => typeof r.slug === 'string')
    .map((r) => ({ slug: r.slug as string, reason: Array.isArray(r.reason) ? r.reason.filter(isSpan) : [] }));
  const sections = BRIEF_KEYS.map((key) => byKey.get(key)).filter((s): s is BriefSection => s !== undefined);
  return { sections, readNext };
}

/** Every block of the brief, for server-side preparation. */
export function briefBlocks(brief: Brief): RenderBlock[][] {
  return brief.sections.map((s) => s.blocks);
}
