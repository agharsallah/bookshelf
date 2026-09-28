/**
 * The audio player: controls of our own — play, skip back 15 s and ahead 30 s, a scrubber
 * marked with the episode's sections, speed, previous and next section, and download —
 * over the app's one `<audio>` element (`nowPlaying`), so what you start keeps playing as
 * you move to other pages (the layout's `NowPlayingBar` takes over there).
 *
 * On mount it takes the element for its recording, where you stopped, unless another one
 * is playing; then it waits, showing your saved place, until you press play. Your place
 * and the Media Session are the store's. It takes keys: Space or K play/pause, ← → skip,
 * [ ] slower/faster, P N previous/next section (`shortcuts={false}` leaves the keys to the
 * page, as the reader, which has its own). `ref` lets the page play from a moment (the
 * transcript, "play from where I am").
 */
import { useEffect, useImperativeHandle, useMemo, useState, type CSSProperties, type Ref } from 'react';
import type { Mark } from '../../lib/api/types/audio';
import { shortcutApplies } from '../study/keys';
import { Kbd } from '../study/ReaderCites';
import { browserStorage, formatTime, markAt, readPosition, sectionJump, SKIP_AHEAD, SKIP_BACK, SPEEDS, spokenTime } from './listening';
import { nowPlaying, type NowPlaying, type Track } from './nowPlaying';
import { useNowPlaying } from './useNowPlaying';
import styles from './Listen.module.css';

export interface PlayerHandle {
  /** Take the element if need be, and play from `seconds`. */
  playFrom: (seconds: number) => void;
}

export interface AudioPlayerProps {
  src: string;
  downloadHref: string;
  downloadName: string;
  /** The episode's title, and the book's (Media Session: title, artist). */
  title: string;
  bookTitle: string;
  sections: readonly Mark[];
  /** From the manifest; the element's own duration wins once it is known. */
  duration: number;
  /** Where to remember your place (`positionKey`). */
  storageKey: string;
  /** The time heard, while this recording is the one loaded (else 0). */
  onTime: (seconds: number) => void;
  /** What listening counts toward in your reading statistics. */
  activity?: Track['activity'];
  /** Take the page's keys (default); false where the page has shortcuts of its own. */
  shortcuts?: boolean;
  ref?: Ref<PlayerHandle>;
  /** The app's player by default; tests pass their own. */
  player?: NowPlaying;
}

/** The app's player, in the browser; none while rendering on the server. */
function browserPlayer(): NowPlaying | null {
  return typeof document === 'undefined' ? null : nowPlaying();
}

const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

export function AudioPlayer(props: AudioPlayerProps) {
  const { src, downloadHref, downloadName, title, bookTitle, sections, duration, storageKey, activity, onTime, shortcuts = true, ref } = props;
  const player = props.player ?? browserPlayer();
  const state = useNowPlaying(player);
  const [savedAt, setSavedAt] = useState(0);
  const { document: activityDocument, unit: activityUnit, detail: activityDetail } = activity ?? {};
  const track = useMemo<Omit<Track, 'href'>>(
    () => ({ src, title, bookTitle, sections, duration, storageKey, activity: activityDocument ? { document: activityDocument, unit: activityUnit, detail: activityDetail } : undefined }),
    [src, title, bookTitle, sections, duration, storageKey, activityDocument, activityUnit, activityDetail],
  );
  const active = state.track?.src === src;
  const playing = active && state.playing;
  const time = active ? state.time : savedAt;
  const length = (active && state.duration) || duration;
  const speed = state.rate;
  const current = markAt(sections, time);

  // Take the element for this recording, unless another one is playing.
  useEffect(() => {
    if (!player) return;
    const now = player.getState();
    if (!now.playing || now.track?.src === track.src) player.load({ ...track, href: here() });
    return player.view(track.src);
  }, [player, track]);

  // Waiting while another recording plays: show where you stopped this one.
  useEffect(() => {
    if (!active) setSavedAt(readPosition(browserStorage(), storageKey) ?? 0);
  }, [active, storageKey]);

  useEffect(() => {
    onTime(active ? state.time : 0);
  }, [active, state.time, onTime]);

  const claim = () => {
    if (player && !active) player.load({ ...track, href: here() });
    return player;
  };
  const seek = (seconds: number) => claim()?.seek(seconds);
  const toggle = () => {
    if (active) player?.toggle();
    else claim()?.play();
  };
  const changeSpeed = (step: 1 | -1) => {
    const index = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    player?.setRate(SPEEDS[Math.min(Math.max((index < 0 ? 1 : index) + step, 0), SPEEDS.length - 1)] ?? 1);
  };
  const jump = (direction: 1 | -1) => {
    const to = sectionJump(sections, time, direction);
    if (to !== null) seek(to);
  };

  useImperativeHandle(ref, () => ({
    playFrom: (seconds: number) => {
      const p = claim();
      p?.seek(seconds);
      p?.play();
    },
  }));

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutApplies(event)) return;
      const actions: Record<string, () => void> = {
        ' ': toggle,
        k: toggle,
        ArrowLeft: () => seek(time - SKIP_BACK),
        ArrowRight: () => seek(time + SKIP_AHEAD),
        '[': () => changeSpeed(-1),
        ']': () => changeSpeed(1),
        p: () => jump(-1),
        n: () => jump(1),
      };
      const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const total = length;
  const keys = (announce: string) => (shortcuts ? announce : undefined);
  const sectionTitle = sections[current]?.title ?? sections[0]?.title ?? '';
  return (
    <div className={styles.player}>
      <p className={styles.now} aria-live="polite">
        <span className={styles.nowLabel}>{current >= 0 ? `Part ${current + 1} of ${sections.length}` : 'Ready'}</span>
        <span className={styles.nowTitle}>{sectionTitle}</span>
      </p>
      <div className={styles.scrub}>
        <input
          type="range"
          className={styles.range}
          min={0}
          max={Math.max(total, 1)}
          step={1}
          value={Math.min(time, total)}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          aria-label="Position"
          aria-valuetext={`${spokenTime(time)} of ${spokenTime(total)}`}
          style={{ '--played': `${total ? (time / total) * 100 : 0}%` } as CSSProperties}
        />
        <ol className={styles.ticks} aria-hidden="true">
          {sections.slice(1).map((mark) => (
            <li key={mark.section} style={{ insetInlineStart: `${total ? (mark.start / total) * 100 : 0}%` }} />
          ))}
        </ol>
        <span className={styles.clock}>
          <span>{formatTime(time)}</span>
          <span>−{formatTime(total - time)}</span>
        </span>
      </div>
      <div className={styles.controls}>
        <button type="button" className={styles.icon} onClick={() => jump(-1)} aria-label="Previous part" aria-keyshortcuts={keys('P')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14 M18 6l-9 6 9 6z" /></svg>
        </button>
        <button type="button" className={styles.icon} onClick={() => seek(time - SKIP_BACK)} aria-label={`Back ${SKIP_BACK} seconds`} aria-keyshortcuts={keys('ArrowLeft')}>
          <span className={styles.skip}>−{SKIP_BACK}</span>
        </button>
        <button type="button" className={styles.play} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts={keys('Space K')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M8 5v14 M16 5v14" /> : <path d="M8 5l11 7-11 7z" />}</svg>
        </button>
        <button type="button" className={styles.icon} onClick={() => seek(time + SKIP_AHEAD)} aria-label={`Ahead ${SKIP_AHEAD} seconds`} aria-keyshortcuts={keys('ArrowRight')}>
          <span className={styles.skip}>+{SKIP_AHEAD}</span>
        </button>
        <button type="button" className={styles.icon} onClick={() => jump(1)} aria-label="Next part" aria-keyshortcuts={keys('N')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14 M6 6l9 6-9 6z" /></svg>
        </button>
      </div>
      <div className={styles.extras}>
        <label className={styles.speed}>
          Speed
          <select value={speed} onChange={(event) => player?.setRate(Number(event.currentTarget.value))} aria-keyshortcuts={keys('[ ]')}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <a className="btn btn-quiet" href={downloadHref} download={downloadName}>
          Download MP3
        </a>
        {shortcuts && (
          <span className={styles.keys} aria-hidden="true">
            <Kbd>Space</Kbd> play · <Kbd>←</Kbd> <Kbd>→</Kbd> skip · <Kbd>[</Kbd> <Kbd>]</Kbd> speed · <Kbd>P</Kbd> <Kbd>N</Kbd> parts
          </span>
        )}
      </div>
    </div>
  );
}

export default AudioPlayer;
