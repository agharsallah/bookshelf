/**
 * The merge-proposal queue (§11: merges are applied by a human, never automatically).
 * Pure state: the proposals still waiting, in order; skipping sends one to the back;
 * resolving (merge or reject) takes it out; undo puts it back where it was.
 */
import type { ConceptSummary, MergeProposal } from '../../lib/api/types/graph';

export interface MergeQueueState {
  items: MergeProposal[];
}

export type MergeQueueAction =
  | { type: 'resolve'; edgeId: string }
  | { type: 'skip'; edgeId: string }
  | { type: 'restore'; proposal: MergeProposal; index: number };

export function mergeQueueReducer(state: MergeQueueState, action: MergeQueueAction): MergeQueueState {
  switch (action.type) {
    case 'resolve':
      return { items: state.items.filter((p) => p.edge_id !== action.edgeId) };
    case 'skip': {
      const item = state.items.find((p) => p.edge_id === action.edgeId);
      if (!item || state.items.length < 2) return state;
      return { items: [...state.items.filter((p) => p !== item), item] };
    }
    case 'restore': {
      if (state.items.some((p) => p.edge_id === action.proposal.edge_id)) return state;
      const items = [...state.items];
      items.splice(Math.max(0, Math.min(action.index, items.length)), 0, action.proposal);
      return { items };
    }
  }
}

/** The survivor to preselect: the suggestion, else the human-curated side, else the one with a gloss. */
export function defaultSurvivor(p: MergeProposal): string {
  if (p.suggested_survivor === p.a.id || p.suggested_survivor === p.b.id) return p.suggested_survivor;
  const score = (c: ConceptSummary) => (c.origin === 'human' ? 2 : 0) + (c.blurb ? 1 : 0) + c.aliases.length * 0.01;
  return score(p.b) > score(p.a) ? p.b.id : p.a.id;
}

/** `POST /concepts/{loser}/merge {into: survivor}`. */
export function mergePlan(p: MergeProposal, survivorId: string): { loser: ConceptSummary; survivor: ConceptSummary } {
  return survivorId === p.b.id ? { loser: p.a, survivor: p.b } : { loser: p.b, survivor: p.a };
}

export function similarityLabel(similarity: number | null): string | null {
  return similarity === null ? null : `${Math.round(similarity * 100)}% similar`;
}
