/**
 * Graph refs ⇄ page URLs. A ref is `<kind>:<id>` and a passage's id carries a `#`
 * (`node:<document_id>#<anchor>`), which a path cannot hold, so the path spells it out:
 *
 *   concept:<id>           → /graph/concept/<id>
 *   document:<id>          → /graph/document/<id>
 *   artifact:<id>          → /graph/artifact/<id>
 *   node:<doc>#ch03/p014   → /graph/node/<doc>/ch03/p014
 *
 * `?depth=2&proposed=1` carry the view options; `?collection=<slug>` keeps the walk inside
 * one collection's documents.
 */
import { ENTITY_KINDS, type EntityKind, type GraphRef } from '../../lib/api/types/graph';
import { collectionParam } from '../collections/path';

export interface GraphView {
  depth: 1 | 2;
  proposed: boolean;
  /** A collection's slug: passages outside its documents are left out. */
  collection?: string | null;
}

export const defaultView: GraphView = { depth: 1, proposed: false };

export interface ParsedRef {
  kind: EntityKind;
  id: string;
  /** Passages only. */
  documentId?: string;
  anchor?: string;
}

function isKind(value: string | undefined): value is EntityKind {
  return value !== undefined && (ENTITY_KINDS as readonly string[]).includes(value);
}

export function parseRef(ref: GraphRef): ParsedRef | null {
  const at = ref.indexOf(':');
  if (at === -1) return null;
  const kind = ref.slice(0, at);
  const id = ref.slice(at + 1);
  if (!isKind(kind) || !id) return null;
  if (kind !== 'node') return { kind, id };
  const hash = id.indexOf('#');
  if (hash <= 0 || hash === id.length - 1) return null;
  return { kind, id, documentId: id.slice(0, hash), anchor: id.slice(hash + 1) };
}

export function graphHref(ref: GraphRef, view: Partial<GraphView> = {}): string {
  const parsed = parseRef(ref);
  const path = !parsed
    ? `/graph/${encodeURIComponent(ref)}`
    : parsed.kind === 'node'
      ? `/graph/node/${encodeURIComponent(parsed.documentId ?? '')}/${(parsed.anchor ?? '').split('/').map(encodeURIComponent).join('/')}`
      : `/graph/${parsed.kind}/${encodeURIComponent(parsed.id)}`;
  const params = new URLSearchParams();
  if (view.depth === 2) params.set('depth', '2');
  if (view.proposed) params.set('proposed', '1');
  if (view.collection) params.set('collection', view.collection);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** The ref a `/graph/<rest>` path names, or null. A lone segment is a bare id. */
export function refFromPath(rest: string): GraphRef | null {
  const segments = rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const [kind, id, ...anchor] = segments;
  if (segments.length === 1 && kind) return kind;
  if (!isKind(kind) || !id) return null;
  if (kind === 'node') return anchor.length ? `node:${id}#${anchor.join('/')}` : null;
  return anchor.length ? null : `${kind}:${id}`;
}

export function viewFromParams(params: URLSearchParams): GraphView {
  const view: GraphView = { depth: params.get('depth') === '2' ? 2 : 1, proposed: params.get('proposed') === '1' };
  const collection = collectionParam(params);
  return collection ? { ...view, collection } : view;
}
