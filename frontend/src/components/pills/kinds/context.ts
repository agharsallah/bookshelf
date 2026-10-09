/**
 * What every kind renderer receives besides its pill: where media lives, how to report an
 * answer, how to magnify, and the review API for `review` pills.
 */
import type { Rating } from '../../../lib/api/types/recalls';
import type { PillKind, PillOf } from '../../../lib/pills/types';
import type { LightboxItem } from '../../figures/Lightbox';
import type { RecallApi } from '../../recall/api';

export interface AnswerValue {
  correct: boolean;
  choice?: number;
  rating?: Rating;
}

export interface KindContext {
  /** The API base that body media paths are relative to (`/api` in the browser). */
  mediaBase: string;
  onAnswer: (value: AnswerValue) => void;
  onMagnify: (item: LightboxItem) => void;
  reviewApi: RecallApi;
}

export interface KindProps<K extends PillKind> {
  pill: PillOf<K>;
  ctx: KindContext;
}
