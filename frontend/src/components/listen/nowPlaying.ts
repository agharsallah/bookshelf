/**
 * What is playing, for the whole app: one `<audio>` element that no page owns, so a
 * recording keeps playing as you move between pages (the layout's `ClientRouter` swaps
 * pages without reloading, and this module, with its element, stays).
 *
 * Players (`AudioPlayer`) are views of it: one claims the element for its recording
 * (`load`) when nothing else is playing, or when you press play on it. When you leave the
 * page, the layout's `NowPlayingBar` shows what is still playing, with a link back.
 *
 * It remembers your place (per recording, in localStorage) and tells the operating system
 * what is playing (Media Session: lock screen, headphone buttons, media keys), whichever
 * page you are on.
 */
import type { Mark } from '../../lib/api/types/audio';
import { browserStorage, readPosition, sectionJump, SKIP_AHEAD, SKIP_BACK, writePosition } from './listening';

export interface Track {
  src: string;
  /** The recording's title, and the book's (Media Session: title, artist). */
  title: string;
  bookTitle: string;
  sections: readonly Mark[];
  /** From the manifest; the element's own duration wins once it is known. */
  duration: number;
  /** Where to remember your place (`positionKey`). */
  storageKey: string;
  /** The page it was started on, to go back to. */
  href: string;
}

export interface NowPlayingState {
  track: Track | null;
  playing: boolean;
  /** Pressed play since it was loaded: until then it is only ready, not "playing on". */
  started: boolean;
  time: number;
  duration: number;
  rate: number;
  /** A player on this page shows the track (so the bar need not). */
  viewed: boolean;
}

const SAVE_EVERY = 5; // seconds of playback between saves of your place
/** Nothing loaded: also what the server renders, where there is no `<audio>`. */
export const IDLE: NowPlayingState = { track: null, playing: false, started: false, time: 0, duration: 0, rate: 1, viewed: false };

export class NowPlaying {
  readonly element: HTMLAudioElement;
  private readonly storage: () => Storage | undefined;
  private state: NowPlayingState = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly views = new Map<string, number>();
  /** Where to start once the recording's length is known (instead of your saved place). */
  private startAt: number | null = null;
  private saved = 0;

  constructor(element: HTMLAudioElement = document.createElement('audio'), storage: () => Storage | undefined = browserStorage) {
    this.element = element;
    this.storage = storage;
    element.preload = 'metadata';
    element.addEventListener('loadedmetadata', () => this.onLoaded());
    element.addEventListener('timeupdate', () => this.onTimeUpdate());
    element.addEventListener('play', () => this.set({ playing: true, started: true }));
    element.addEventListener('pause', () => {
      this.set({ playing: false });
      // Switching recordings pauses too, at 0 of the new one: that must not forget its place.
      if (element.currentTime > 0) this.remember(element.currentTime);
    });
    element.addEventListener('ended', () => {
      this.set({ playing: false });
      this.remember(null);
    });
    this.bindMediaSession();
  }

  getState = (): NowPlayingState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Make `track` the one playing (paused where you left it), unless it already is. */
  load(track: Track): void {
    const current = this.state.track;
    if (current?.src === track.src) {
      this.set({ track: { ...track, href: current.href } });
      return;
    }
    if (current && this.element.currentTime > 0) this.remember(this.element.currentTime);
    this.startAt = null;
    this.saved = 0;
    this.element.src = track.src;
    this.element.currentTime = 0; // browsers do this on a new src; say so for those that don't
    this.element.defaultPlaybackRate = this.state.rate;
    this.element.playbackRate = this.state.rate;
    const time = readPosition(this.storage(), track.storageKey) ?? 0;
    this.set({ track, playing: false, started: false, time, duration: track.duration, viewed: (this.views.get(track.src) ?? 0) > 0 });
    this.updateMetadata();
  }

  play(): void {
    if (!this.state.track) return;
    void this.element.play().catch(() => this.set({ playing: false }));
  }

  pause(): void {
    this.element.pause();
  }

  toggle(): void {
    if (this.element.paused) this.play();
    else this.pause();
  }

  seek(seconds: number): void {
    if (!this.state.track) return;
    const length = Number.isFinite(this.element.duration) ? this.element.duration : this.state.duration;
    const to = Math.min(Math.max(seconds, 0), length || Infinity);
    if (this.element.readyState < 1) this.startAt = to;
    this.element.currentTime = to;
    this.set({ time: to });
  }

  skip(seconds: number): void {
    this.seek(this.element.currentTime + seconds);
  }

  /** The next or previous section (part) of the recording. */
  jump(direction: 1 | -1): void {
    const to = sectionJump(this.state.track?.sections ?? [], this.element.currentTime, direction);
    if (to !== null) this.seek(to);
  }

  setRate(rate: number): void {
    this.element.defaultPlaybackRate = rate;
    this.element.playbackRate = rate;
    this.set({ rate });
  }

  /** Stop and forget the track (the bar's close button). */
  stop(): void {
    if (this.state.track) this.remember(this.element.currentTime);
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    this.set({ ...IDLE, rate: this.state.rate });
    this.updateMetadata();
  }

  /** A player on the page shows `src`; call the returned function when it goes. */
  view(src: string): () => void {
    this.views.set(src, (this.views.get(src) ?? 0) + 1);
    this.syncViewed();
    return () => {
      const left = (this.views.get(src) ?? 1) - 1;
      if (left > 0) this.views.set(src, left);
      else this.views.delete(src);
      this.syncViewed();
    };
  }

  private syncViewed(): void {
    const src = this.state.track?.src;
    this.set({ viewed: src !== undefined && (this.views.get(src) ?? 0) > 0 });
  }

  private onLoaded(): void {
    const el = this.element;
    const track = this.state.track;
    if (!track) return;
    const duration = Number.isFinite(el.duration) ? el.duration : this.state.duration;
    const resume = this.startAt ?? readPosition(this.storage(), track.storageKey);
    this.startAt = null;
    if (resume !== null && resume < duration - 10 && Math.abs(el.currentTime - resume) > 0.5) el.currentTime = resume;
    this.set({ duration, time: el.currentTime });
  }

  private onTimeUpdate(): void {
    const time = this.element.currentTime;
    this.set({ time });
    if (Math.abs(time - this.saved) >= SAVE_EVERY) {
      this.saved = time;
      this.remember(time);
    }
  }

  private remember(time: number | null): void {
    const track = this.state.track;
    if (track) writePosition(this.storage(), track.storageKey, time);
  }

  private set(patch: Partial<NowPlayingState>): void {
    const next = { ...this.state, ...patch };
    const changed = (Object.keys(patch) as (keyof NowPlayingState)[]).some((key) => next[key] !== this.state[key]);
    if (!changed) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private updateMetadata(): void {
    const session = mediaSession();
    if (!session) return;
    const track = this.state.track;
    session.metadata = track ? new MediaMetadata({ title: track.title, artist: track.bookTitle, album: 'Bookshelf' }) : null;
  }

  private bindMediaSession(): void {
    const session = mediaSession();
    if (!session) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.play()],
      ['pause', () => this.pause()],
      ['seekbackward', (d) => this.skip(-(d.seekOffset ?? SKIP_BACK))],
      ['seekforward', (d) => this.skip(d.seekOffset ?? SKIP_AHEAD)],
      ['seekto', (d) => d.seekTime !== undefined && this.seek(d.seekTime)],
      ['previoustrack', () => this.jump(-1)],
      ['nexttrack', () => this.jump(1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this browser does not support.
      }
    }
  }
}

function mediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return null;
  return navigator.mediaSession;
}

let shared: NowPlaying | null = null;

/** The app's one player, made on first use (in the browser only). */
export function nowPlaying(): NowPlaying {
  shared ??= new NowPlaying();
  return shared;
}
