/**
 * An original figure in the pane's Figures tab: the image cropped from the source (it opens
 * in the lightbox), its own caption, and a line under it mapping it to the text and to its
 * explanation — its place among the chapter's figures, its page, a jump to it in the text,
 * and whether an explanation follows.
 */
import type { OriginalFigure } from './figures';
import styles from './DistillPane.module.css';

export interface OriginalFigureViewProps {
  anchor: string;
  figure: OriginalFigure;
  explained: boolean;
  onOpen: (anchor: string) => void;
  onShow: (anchor: string) => void;
}

export function OriginalFigureView({ anchor, figure, explained, onOpen, onShow }: OriginalFigureViewProps) {
  return (
    <figure className={styles.original} data-original={anchor}>
      <button type="button" className={styles.originalImage} onClick={() => onOpen(anchor)} aria-label={`Magnify the original: ${figure.alt}`}>
        <img src={figure.src} alt={figure.alt} loading="lazy" decoding="async" />
      </button>
      {figure.caption ? <figcaption className={styles.originalCaption}>{figure.caption}</figcaption> : null}
      <p className={styles.mapping}>
        <span>
          Original, figure {figure.n} of {figure.of}
          {figure.page !== null ? `, p. ${figure.page}` : ''}
        </span>
        <span aria-hidden="true">·</span>
        <button type="button" className={styles.mappingLink} onClick={() => onShow(anchor)}>
          Show in text
        </button>
        <span aria-hidden="true">·</span>
        <span data-explained={explained ? '' : undefined}>{explained ? 'Explained below' : 'Not explained yet'}</span>
      </p>
    </figure>
  );
}
