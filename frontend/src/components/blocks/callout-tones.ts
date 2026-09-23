/**
 * What each callout tone means (§9) and how it is marked. Tones differ by hue,
 * glyph *and* rule style, so they stay distinct without color.
 */
import type { CalloutTone } from '../../lib/contract';

export interface ToneMeta {
  label: string;
  /** Marginal glyph; decorative, the label carries the meaning. */
  glyph: string;
  meaning: string;
}

export const TONES: Record<CalloutTone, ToneMeta> = {
  important: { label: 'Important', glyph: '☞︎', meaning: 'What the author insists on.' },
  remember: { label: 'Remember', glyph: 'N.B.', meaning: 'What you should be able to recall cold.' },
  antipattern: { label: 'Antipattern', glyph: '⊘', meaning: 'What the author warns against.' },
  insight: { label: 'Insight', glyph: '✦', meaning: 'A non-obvious consequence worth keeping.' },
  caution: { label: 'Caution', glyph: '!', meaning: 'A limit, caveat or condition to respect.' },
  contrast: { label: 'Contrast', glyph: '⇄', meaning: 'Where this differs from another view.' },
  question: { label: 'Question', glyph: '?', meaning: 'An open question the text leaves you with.' },
};
