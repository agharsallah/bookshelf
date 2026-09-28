// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer, type PlayerHandle } from './AudioPlayer';
import { EPISODE } from './fixtures';
import { NowPlaying } from './nowPlaying';

const RENDER = EPISODE.renders[0]!;
const SRC = '/api/audio/files/doc/art-1/r1.mp3';

function setup({ onTime = vi.fn(), shortcuts = undefined as boolean | undefined, player = new NowPlaying(document.createElement('audio'), () => localStorage) } = {}) {
  const handle = createRef<PlayerHandle>();
  const view = render(
    <AudioPlayer
      ref={handle}
      player={player}
      src={SRC}
      downloadHref={`${SRC}?download=Book.mp3`}
      downloadName="Book.mp3"
      title="Why busy teams are slow"
      bookTitle="Queueing"
      sections={RENDER.sections}
      duration={RENDER.duration}
      storageKey="bookshelf:listen:r1"
      onTime={onTime}
      shortcuts={shortcuts}
    />,
  );
  const el = player.element;
  Object.defineProperty(el, 'duration', { configurable: true, value: 100 });
  return { el, onTime, player, handle, unmount: view.unmount };
}

let paused = true;
beforeEach(() => {
  paused = true;
  localStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    paused = true;
    this.dispatchEvent(new Event('pause'));
  });
});
afterEach(() => vi.restoreAllMocks());

describe('AudioPlayer', () => {
  it('takes the app’s player for its recording, and plays and pauses it', async () => {
    const { el } = setup();
    expect(el.getAttribute('src')).toBe(SRC);
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(el.play).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('skips with the buttons and the arrow keys, and moves between parts', async () => {
    const { el } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Ahead 30 seconds' }));
    expect(el.currentTime).toBe(30);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(el.currentTime).toBe(15);
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(el.currentTime).toBe(41);
  });

  it('shows the part playing and follows the time', () => {
    const { el, onTime } = setup();
    el.currentTime = 50;
    fireEvent.timeUpdate(el);
    expect(screen.getByText('Part 2 of 2')).toBeTruthy();
    expect(screen.getByText('Start less')).toBeTruthy();
    expect(onTime).toHaveBeenLastCalledWith(50);
    expect(screen.getByRole('slider', { name: 'Position' }).getAttribute('aria-valuetext')).toBe('50 seconds of 1 minute 40 seconds');
  });

  it('picks up where you stopped, and remembers where you pause', () => {
    localStorage.setItem('bookshelf:listen:r1', '62');
    const { el } = setup();
    fireEvent.loadedMetadata(el);
    expect(el.currentTime).toBe(62);
    el.currentTime = 70;
    fireEvent.pause(el);
    expect(localStorage.getItem('bookshelf:listen:r1')).toBe('70');
    fireEvent.ended(el);
    expect(localStorage.getItem('bookshelf:listen:r1')).toBeNull();
  });

  it('changes speed from the menu and the bracket keys', () => {
    const { el } = setup();
    fireEvent.keyDown(document.body, { key: ']' });
    expect(el.playbackRate).toBe(1.15);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(el.playbackRate).toBe(2);
  });

  it('leaves the keys to the page when it has shortcuts of its own', () => {
    const { el } = setup({ shortcuts: false });
    el.currentTime = 50;
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: ']' });
    expect(el.currentTime).toBe(50);
    expect(el.playbackRate).toBe(1);
    expect(screen.getByRole('button', { name: 'Play' }).getAttribute('aria-keyshortcuts')).toBeNull();
  });

  it('plays from a moment the page asks for', () => {
    const { el, handle } = setup();
    handle.current!.playFrom(41);
    expect(el.currentTime).toBe(41);
    expect(el.play).toHaveBeenCalled();
  });

  it('keeps playing when it goes, and says so no longer shows it', async () => {
    const { el, player, unmount } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(player.getState().viewed).toBe(true);
    unmount();
    expect(el.pause).not.toHaveBeenCalled();
    expect(player.getState()).toMatchObject({ playing: true, viewed: false });
  });

  it('waits while another recording plays, and takes over when you press play', async () => {
    const player = new NowPlaying(document.createElement('audio'), () => localStorage);
    player.load({ src: '/other.mp3', title: 'Other', bookTitle: 'B', sections: [], duration: 60, storageKey: 'k', href: '/elsewhere' });
    player.play();
    localStorage.setItem('bookshelf:listen:r1', '62');
    const { el, onTime } = setup({ player });

    expect(el.getAttribute('src')).toBe('/other.mp3');
    expect(screen.getByRole('slider', { name: 'Position' }).getAttribute('aria-valuetext')).toContain('1 minute 2 seconds of');
    expect(onTime).toHaveBeenLastCalledWith(0);

    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(el.getAttribute('src')).toBe(SRC);
    expect(player.getState().track?.title).toBe('Why busy teams are slow');
  });

  it('offers the MP3 as a download', () => {
    setup();
    const link = screen.getByRole('link', { name: 'Download MP3' });
    expect(link.getAttribute('download')).toBe('Book.mp3');
    expect(link.getAttribute('href')).toContain('download=Book.mp3');
  });
});
