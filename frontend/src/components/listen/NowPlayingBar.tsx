/**
 * What is still playing, on every page (mounted once in the layout, kept across
 * navigations): the recording you started elsewhere — an episode, a chapter read aloud —
 * with play/pause, skip, a link back to where you started it, and stop.
 *
 * Shown once you have pressed play, and only where no player on the page shows the same
 * recording (`viewed`). While it shows, `<html data-now-playing>` reserves room for it at
 * the bottom of the page (base.css), re-applied after each page swap, which resets the
 * root's attributes.
 */
import { useEffect, type CSSProperties } from 'react';
import { formatTime, SKIP_AHEAD, SKIP_BACK, spokenTime } from './listening';
import { nowPlaying, type NowPlaying } from './nowPlaying';
import { useNowPlaying } from './useNowPlaying';
import styles from './NowPlayingBar.module.css';

export interface NowPlayingBarProps {
  /** The app's player by default; tests pass their own. */
  player?: NowPlaying;
}

export const NOW_PLAYING_ATTR = 'data-now-playing';

export function NowPlayingBar({ player = nowPlaying() }: NowPlayingBarProps) {
  const { track, playing, started, time, duration, viewed } = useNowPlaying(player);
  const shown = track !== null && started && !viewed;

  useEffect(() => {
    if (!shown) return;
    const reserve = () => document.documentElement.setAttribute(NOW_PLAYING_ATTR, '');
    reserve();
    document.addEventListener('astro:after-swap', reserve);
    return () => {
      document.removeEventListener('astro:after-swap', reserve);
      document.documentElement.removeAttribute(NOW_PLAYING_ATTR);
    };
  }, [shown]);

  if (!shown) return null;
  const played = duration > 0 ? Math.min(time / duration, 1) * 100 : 0;
  return (
    <aside className={styles.bar} aria-label="Now playing" style={{ '--played': `${played}%` } as CSSProperties}>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${spokenTime(time)} of ${spokenTime(duration)}`}
      />
      <button type="button" className={styles.play} onClick={() => player.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M8 5v14 M16 5v14" /> : <path d="M8 5l11 7-11 7z" />}</svg>
      </button>
      <p className={styles.what}>
        <a className={styles.title} href={track.href}>
          {track.title}
        </a>
        <span className={styles.meta}>
          {track.bookTitle} · <span className={styles.clock}>−{formatTime(duration - time)}</span>
        </span>
      </p>
      <button type="button" className={styles.icon} onClick={() => player.skip(-SKIP_BACK)} aria-label={`Back ${SKIP_BACK} seconds`}>
        −{SKIP_BACK}
      </button>
      <button type="button" className={styles.icon} onClick={() => player.skip(SKIP_AHEAD)} aria-label={`Ahead ${SKIP_AHEAD} seconds`}>
        +{SKIP_AHEAD}
      </button>
      <button type="button" className={styles.icon} onClick={() => player.stop()} aria-label="Stop and close">
        ×
      </button>
    </aside>
  );
}

export default NowPlayingBar;
