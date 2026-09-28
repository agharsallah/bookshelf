/**
 * The audio player: a native `<audio>` (so the browser streams, seeks by byte range and
 * keeps playing in the background) under controls of our own — play, skip back 15 s and
 * ahead 30 s, a scrubber marked with the episode's sections, speed, previous and next
 * section, and download.
 *
 * It picks up where you stopped (per render, in localStorage), tells the operating system
 * what is playing (Media Session: lock screen, headphone buttons, media keys), and takes
 * keys: Space or K play/pause, ← → skip, [ ] slower/faster, P N previous/next section
 * (`shortcuts={false}` leaves the keys to the page, as the reader, which has its own).
 * The parent owns the `<audio>` element's ref, so the transcript can seek it too.
 */
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import type { Mark } from '../../lib/api/types/audio';
import { shortcutApplies } from '../study/keys';
import { Kbd } from '../study/ReaderCites';
import {
  browserStorage,
  formatTime,
  markAt,
  readPosition,
  sectionJump,
  SKIP_AHEAD,
  SKIP_BACK,
  SPEEDS,
  spokenTime,
  writePosition,
} from './listening';
import styles from './Listen.module.css';

export interface AudioPlayerProps {
  audio: RefObject<HTMLAudioElement | null>;
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
  onTime: (seconds: number) => void;
  /** Take the page's keys (default); false where the page has shortcuts of its own. */
  shortcuts?: boolean;
}

const SAVE_EVERY = 5; // seconds of playback between saves of your place

export function AudioPlayer({ audio, src, downloadHref, downloadName, title, bookTitle, sections, duration, storageKey, onTime, shortcuts = true }: AudioPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(duration);
  const [speed, setSpeed] = useState(1);
  const current = markAt(sections, time);

  const seek = (seconds: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(seconds, 0), Number.isFinite(el.duration) ? el.duration : length);
  };
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };
  const changeSpeed = (step: 1 | -1) => {
    const index = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
    const next = SPEEDS[Math.min(Math.max((index < 0 ? 1 : index) + step, 0), SPEEDS.length - 1)] ?? 1;
    setSpeed(next);
  };
  const jump = (direction: 1 | -1) => {
    const to = sectionJump(sections, audio.current?.currentTime ?? time, direction);
    if (to !== null) seek(to);
  };

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [audio, speed]);

  // Events of the element: time, play state, and your place, saved as you listen.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    let saved = 0;
    const onLoaded = () => {
      if (Number.isFinite(el.duration)) setLength(el.duration);
      const resume = readPosition(browserStorage(), storageKey);
      if (resume !== null && resume < el.duration - 10) el.currentTime = resume;
    };
    const onTimeUpdate = () => {
      setTime(el.currentTime);
      onTime(el.currentTime);
      if (Math.abs(el.currentTime - saved) >= SAVE_EVERY) {
        saved = el.currentTime;
        writePosition(browserStorage(), storageKey, el.currentTime);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      writePosition(browserStorage(), storageKey, el.currentTime);
    };
    const onEnded = () => {
      setPlaying(false);
      writePosition(browserStorage(), storageKey, null);
    };
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    if (el.readyState >= 1) onLoaded();
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [audio, storageKey, onTime]);

  // The operating system's media controls.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({ title, artist: bookTitle, album: 'Bookshelf' });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void audio.current?.play()],
      ['pause', () => audio.current?.pause()],
      ['seekbackward', (d) => seek((audio.current?.currentTime ?? 0) - (d.seekOffset ?? SKIP_BACK))],
      ['seekforward', (d) => seek((audio.current?.currentTime ?? 0) + (d.seekOffset ?? SKIP_AHEAD))],
      ['seekto', (d) => d.seekTime !== undefined && seek(d.seekTime)],
      ['previoustrack', () => jump(-1)],
      ['nexttrack', () => jump(1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this browser does not support.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
    };
  });

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

  const total = length || duration;
  const keys = (announce: string) => (shortcuts ? announce : undefined);
  const sectionTitle = sections[current]?.title ?? sections[0]?.title ?? '';
  return (
    <div className={styles.player}>
      <audio ref={audio} src={src} preload="metadata" />
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
          <select value={speed} onChange={(event) => setSpeed(Number(event.currentTarget.value))} aria-keyshortcuts={keys('[ ]')}>
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
