/**
 * Cross-document cites in answers. The backend qualifies every answer cite as
 * `<slug>:<anchor>` (`:` never occurs in a slug or an anchor) and sends a `sources` map
 * keyed by those strings. Each cited document gets a siglum (A, B, C…), the way a
 * scholarly apparatus names its witnesses, so a chip reads `A 3.2 ¶14`.
 */
import { anchorLabel } from '../../lib/anchors';
import type { CiteSource, SearchDocument } from '../../lib/api/types/search';
import { readerHref } from './links';

export interface CiteParts {
  slug: string | null;
  anchor: string;
}

export function splitCite(cite: string): CiteParts {
  const at = cite.indexOf(':');
  return at === -1 ? { slug: null, anchor: cite } : { slug: cite.slice(0, at), anchor: cite.slice(at + 1) };
}

export interface SourceDocument {
  siglum: string;
  document: SearchDocument;
  /** Cite keys into this document, in anchor order. */
  cites: { key: string; anchor: string; href: string }[];
}

export interface CiteIndex {
  documents: SourceDocument[];
  href(cite: string): string;
  label(cite: string): string;
  title(cite: string): string;
}

/** A, B … Z, AA, AB … */
export function siglum(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Index an answer's sources. Documents are lettered in the order the answer first
 * cites them (`order`, usually `collectCites(blocks)`), then any uncited source.
 * A bare anchor resolves only when the answer draws on a single document.
 */
export function indexCites(sources: Record<string, CiteSource>, order: readonly string[] = []): CiteIndex {
  const bySlug = new Map<string, SourceDocument>();
  const keys = [...new Set([...order.filter((k) => k in sources), ...Object.keys(sources)])];
  for (const key of keys) {
    const source = sources[key];
    if (!source) continue;
    const slug = source.document.slug;
    let entry = bySlug.get(slug);
    if (!entry) {
      entry = { siglum: siglum(bySlug.size), document: source.document, cites: [] };
      bySlug.set(slug, entry);
    }
    entry.cites.push({ key, anchor: source.anchor, href: readerHref(slug, source.anchor) });
  }
  const documents = [...bySlug.values()];
  documents.forEach((d) => d.cites.sort((a, b) => a.anchor.localeCompare(b.anchor, undefined, { numeric: true })));
  const only = documents.length === 1 ? documents[0] : undefined;

  function locate(cite: string): { doc: SourceDocument | undefined; slug: string | null; anchor: string } {
    const source = sources[cite];
    if (source) return { doc: bySlug.get(source.document.slug), slug: source.document.slug, anchor: source.anchor };
    const { slug, anchor } = splitCite(cite);
    if (slug) return { doc: bySlug.get(slug), slug, anchor };
    return { doc: only, slug: only?.document.slug ?? null, anchor };
  }

  return {
    documents,
    href(cite) {
      const { slug, anchor } = locate(cite);
      return slug ? readerHref(slug, anchor) : `#${anchor}`;
    },
    label(cite) {
      const { doc, anchor } = locate(cite);
      const short = anchorLabel(anchor);
      return doc && documents.length > 1 ? `${doc.siglum} ${short}` : short;
    },
    title(cite) {
      const { doc, slug, anchor } = locate(cite);
      const name = doc?.document.title ?? slug;
      return name ? `${name}, ${anchor}` : anchor;
    },
  };
}
