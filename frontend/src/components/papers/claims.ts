/**
 * The claims tab's view model (pure). Claims come from `GET /papers/{ref}/claims` once a
 * claim_set is approved (rows with ids and relation counts); before that, from the draft
 * artifact's body, grouped here the way the backend would (the unit of the first cite
 * inside one), with no relations. Also the words for relation counts and single relations.
 */
import type { ClaimKind, ClaimStrength } from '../../lib/api/types/papers';
import type { ClaimRelation, ClaimRelationCounts, PaperClaims } from '../../lib/api/types/paperStudy';
import { chapterLabel } from '../guide/guide';
import { unitOfAnchor, type PassageUnit } from '../guide/passage';
import type { DraftClaim } from './extract-bodies';

export interface ClaimView {
  /** The claim row's id; null for a draft's claim (no relations yet). */
  id: string | null;
  key: string;
  text: string;
  kind: ClaimKind;
  strength: ClaimStrength;
  evidence: string[];
  relations: ClaimRelationCounts | null;
}

export interface ClaimGroup {
  /** The unit anchor; null for claims resting only on the abstract (or outside every unit). */
  unit: string | null;
  heading: string;
  claims: ClaimView[];
}

const ABSTRACT = 'Abstract and front matter';

/** A heading that prints its own section number ("3 BERT", "A.2 Setup"). */
const PRINTED_NUMBER = /^(\d+|[A-Z])(\.\d+)*\s/;

/** "3 Method" for a numbered chapter, the heading alone otherwise, or when the heading
 * already prints the paper's own number (a paper's `ch04` is often "3 …"). */
export function unitHeading(anchor: string | null, heading: string | null): string {
  if (anchor === null) return heading ?? ABSTRACT;
  const n = chapterLabel(anchor);
  const text = heading ?? anchor;
  return /^\d+$/.test(n) && !PRINTED_NUMBER.test(text) ? `${n} ${text}` : text;
}

/** The API's groups, as views. */
export function claimGroups(data: PaperClaims): ClaimGroup[] {
  return data.units
    .filter((g) => g.claims.length > 0)
    .map((g) => ({
      unit: g.unit,
      heading: unitHeading(g.unit, g.heading),
      claims: g.claims.map((c) => ({ id: c.id, key: c.key, text: c.text, kind: c.kind, strength: c.strength, evidence: c.evidence, relations: c.relations })),
    }));
}

/**
 * A draft's claims grouped by unit in reading order (the units' order), abstract-only
 * claims first, each group keeping the claims' own order.
 */
export function groupDraftClaims(claims: readonly DraftClaim[], units: readonly PassageUnit[]): ClaimGroup[] {
  const unitOf = (c: DraftClaim) => c.cites.map((a) => unitOfAnchor(units, a)).find((u) => u !== null) ?? null;
  const placed = claims.map((c) => ({ claim: c, unit: unitOf(c) }));
  const view = (c: DraftClaim): ClaimView => ({ id: null, key: c.key, text: c.text, kind: c.kind, strength: c.strength, evidence: c.cites, relations: null });
  const loose = placed.filter((p) => p.unit === null).map((p) => view(p.claim));
  return [
    ...(loose.length ? [{ unit: null, heading: ABSTRACT, claims: loose }] : []),
    ...units.flatMap((u) => {
      const mine = placed.filter((p) => p.unit?.anchor === u.anchor).map((p) => view(p.claim));
      return mine.length ? [{ unit: u.anchor, heading: unitHeading(u.anchor, u.heading), claims: mine }] : [];
    }),
  ];
}

/** "supported by 1 · contradicted by 2 on your shelf", or null when nothing bears on it. */
export function relationSummary(counts: ClaimRelationCounts | null): string | null {
  if (!counts) return null;
  const parts = [
    counts.supported_by ? `supported by ${counts.supported_by}` : null,
    counts.contradicted_by ? `contradicted by ${counts.contradicted_by}` : null,
    counts.extended_by ? `extended by ${counts.extended_by}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `${parts.join(' · ')} on your shelf` : null;
}

/** Whether a claim has any relation to open (accepted either way, or proposed). */
export function hasRelations(counts: ClaimRelationCounts | null): boolean {
  if (!counts) return false;
  return Object.values(counts).some((n) => n > 0);
}

/** Totals over every claim, for the tab's summary line. */
export function relationTotals(groups: readonly ClaimGroup[]): ClaimRelationCounts {
  const zero: ClaimRelationCounts = { supported_by: 0, contradicted_by: 0, extended_by: 0, supports: 0, extends: 0, proposed: 0 };
  return groups
    .flatMap((g) => g.claims)
    .reduce((sum, c) => {
      if (!c.relations) return sum;
      const r = c.relations;
      return {
        supported_by: sum.supported_by + r.supported_by,
        contradicted_by: sum.contradicted_by + r.contradicted_by,
        extended_by: sum.extended_by + r.extended_by,
        supports: sum.supports + r.supports,
        extends: sum.extends + r.extends,
        proposed: sum.proposed + r.proposed,
      };
    }, zero);
}

export type RelationTone = 'support' | 'contradict' | 'extend' | 'other';

/** How one relation reads from the claim asked about: "Supported by", "Contradicts"… */
export function relationPhrase(rel: Pick<ClaimRelation, 'relation' | 'direction'>): { text: string; tone: RelationTone } {
  const incoming = rel.direction === 'in';
  switch (rel.relation) {
    case 'supports':
      return { text: incoming ? 'Supported by' : 'Supports', tone: 'support' };
    case 'contradicts':
      return { text: 'Contradicted by', tone: 'contradict' };
    case 'extends':
      return { text: incoming ? 'Extended by' : 'Extends', tone: 'extend' };
    default:
      return { text: incoming ? `${rel.relation} (from)` : rel.relation, tone: 'other' };
  }
}
