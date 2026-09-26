/**
 * The search modes in plain words. The backend router (retrieval/router.py) picks one
 * from how a query is phrased when the mode is Auto; the others force it. Labels here
 * are the reader's names for them; the API keeps its own (`addressed`, `lexical`…).
 */
import type { Intent, SearchMode } from '../../lib/api/types/search';
import type { SearchState } from './url-state';

export interface ModeOption {
  mode: SearchMode;
  label: string;
  description: string;
}

export const MODE_OPTIONS: readonly ModeOption[] = [
  {
    mode: 'auto',
    label: 'Let Bookshelf decide',
    description:
      'Reads how you phrase it: a chapter you name opens that chapter, words in "quotes" find the exact text, "compare" or "vs" looks across books, anything else searches by meaning.',
  },
  {
    mode: 'discovery',
    label: 'By meaning',
    description: 'Finds the idea even when the words differ: your approved distillations first, then the passages they rest on.',
  },
  {
    mode: 'synthesis',
    label: 'Across books',
    description: 'Searches by meaning over more books at once and shows where their concepts agree or contradict.',
  },
  {
    mode: 'lexical',
    label: 'Exact words',
    description: 'Matches the words in the source text itself; put a phrase in quotes to find it word for word. Works even without the search index.',
  },
  {
    mode: 'addressed',
    label: 'Go to a chapter',
    description: 'Treats the query as a place, like "chapter 3 of Meadows", and opens that chapter with what you approved for it.',
  },
];

/** What the search actually did, shown beside the query once results are in. */
export const INTENT_NOTES: Record<Intent, string> = {
  addressed: 'Went straight to the chapter you named',
  discovery: 'Searched by meaning',
  synthesis: 'Looked across books',
  lexical: 'Matched the exact words',
};

export function modeLabel(mode: SearchMode): string {
  return MODE_OPTIONS.find((m) => m.mode === mode)?.label ?? mode;
}

/** The disclosure's summary of what is changed from the defaults, or '' when nothing is. */
export function optionsSummary(state: Pick<SearchState, 'mode' | 'documents' | 'tags' | 'types'>): string {
  const parts: string[] = [];
  if (state.mode !== 'auto') parts.push(modeLabel(state.mode));
  const filters = state.documents.length + state.tags.length + state.types.length;
  if (filters) parts.push(filters === 1 ? '1 filter' : `${filters} filters`);
  return parts.join(', ');
}
