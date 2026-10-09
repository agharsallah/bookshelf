/**
 * The kinds that show something: a figure crop that magnifies in the reader's lightbox, a
 * diagram through the Mermaid block, a formula through the KaTeX block (with a try-it
 * that holds back its answer), and a listening clip that never plays on its own.
 */
import { useRef, useState } from 'react';
import { mediaUrl } from '../../../lib/pills/types';
import { Blocks } from '../../blocks/Blocks';
import { Spans } from '../../blocks/Spans';
import { usePillCites } from '../PillCites';
import type { KindProps } from './context';
import styles from './Kinds.module.css';

export function FigurePill({ pill, ctx }: KindProps<'figure'>) {
  const { image_url, caption, takeaway } = pill.body;
  const src = mediaUrl(ctx.mediaBase, image_url);
  const title = caption ?? pill.headline ?? 'Figure';
  const magnify = () => ctx.onMagnify({ id: pill.id, kind: 'image', src, title, alt: title, meta: pill.document.title });
  return (
    <figure className={styles.figure}>
      <button type="button" className={styles.crop} onClick={magnify} aria-label={`Magnify: ${title}`}>
        <img src={src} alt={title} loading="lazy" decoding="async" />
      </button>
      {caption ? <figcaption className={styles.caption}>{caption}</figcaption> : null}
      <p className={styles.takeaway}>
        <Spans spans={takeaway} />
      </p>
    </figure>
  );
}

export function DiagramPill({ pill, ctx }: KindProps<'diagram'>) {
  const cite = usePillCites(pill, pill.document.slug);
  const { diagram, caption } = pill.body;
  return (
    <div className={styles.drawing}>
      <Blocks
        blocks={[{ ...diagram, cites: [] }] /* the card lists the sources once */}
        {...cite}
        onMagnify={(target) => ctx.onMagnify({ id: `${pill.id}:diagram`, kind: 'svg', html: target.html, title: caption ?? target.title, alt: target.alt })}
      />
      {caption ? <p className={styles.caption}>{caption}</p> : null}
    </div>
  );
}

export function MathPill({ pill }: KindProps<'math'>) {
  const cite = usePillCites(pill, pill.document.slug);
  const [shown, setShown] = useState(false);
  const { latex, name, plain, try_it } = pill.body;
  return (
    <div className={styles.math}>
      <p className={styles.formulaName}>{name}</p>
      <Blocks blocks={[{ type: 'math', latex, meaning: plain, cites: [] }]} {...cite} />
      {try_it ? (
        <div className={styles.tryIt}>
          <p className={styles.question}>{try_it.question}</p>
          {shown ? (
            <p className={styles.payoff}>
              <Spans spans={try_it.answer} />
            </p>
          ) : (
            <button type="button" className="btn" onClick={() => setShown(true)}>
              Show the answer
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A clip of an audio summary: `#t=` seeks to its start; it pauses at its end. */
export function ListenPill({ pill, ctx }: KindProps<'listen'>) {
  const audio = useRef<HTMLAudioElement>(null);
  const { audio_url, start_ms, end_ms, transcript } = pill.body;
  const src = `${mediaUrl(ctx.mediaBase, audio_url)}#t=${start_ms / 1000},${end_ms / 1000}`;
  const seconds = Math.max(1, Math.round((end_ms - start_ms) / 1000));
  const stopAtEnd = () => {
    const el = audio.current;
    if (el && el.currentTime * 1000 >= end_ms) el.pause();
  };
  return (
    <div className={styles.listen}>
      <audio ref={audio} className={styles.player} src={src} controls preload="none" onTimeUpdate={stopAtEnd} aria-label={`Listen: ${seconds} seconds`} />
      <p className={styles.transcript}>
        <Spans spans={transcript} />
      </p>
    </div>
  );
}
