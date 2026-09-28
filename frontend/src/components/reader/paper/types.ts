/**
 * What the reader knows about a paper, loaded by the read page (./load.ts) and handed to
 * the island. Absent for books and articles: the reader then behaves exactly as before.
 */
import type { Spans } from '../../../lib/contract';
import type { ClaimMark } from '../../../lib/api/types/paperStudy';
import type { PaperPassPublic } from '../../../lib/api/types/papers';
import type { PreparedSymbol } from '../../papers/notation';

export interface PaperNotation {
  artifactId: string;
  standing: 'approved' | 'draft';
  /** In order of first use, with KaTeX HTML (components/papers/notation.ts). */
  symbols: PreparedSymbol[];
}

export interface PaperUnit {
  anchor: string;
  heading: string;
  /** `meta.role` from paper_structure (abstract, introduction, …); null when untagged. */
  role: string | null;
}

export interface PaperReading {
  /** Completed passes, as `GET /papers/{ref}` lists them. */
  passes: PaperPassPublic[];
  /** Every reading unit with its role, in reading order. */
  units: PaperUnit[];
  /** Claim marks of the unit on screen (`GET /documents/{ref}/claims/marks?unit=`). */
  marks: ClaimMark[];
  notation: PaperNotation | null;
  /** The review-paper artifact's questions, prompts at the end of pass 3. */
  questions: Spans[];
}
