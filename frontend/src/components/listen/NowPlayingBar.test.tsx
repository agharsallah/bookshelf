// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW_PLAYING_ATTR, NowPlayingBar } from './NowPlayingBar';
import { NowPlaying, type Track } from './nowPlaying';

const TRACK: Track = { src: '/a.mp3', title: 'Stocks and flows', bookTitle: 'Thinking in Systems', sections: [], duration: 120, storageKey: 'k:a', href: '/documents/tis/read/ch01' };

let player: NowPlaying;
beforeEach(() => {
  localStorage.clear();
  player = new NowPlaying(document.createElement('audio'), () => localStorage);
  let paused = true;
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

describe('NowPlayingBar', () => {
  it('stays away until something has been played', () => {
    render(<NowPlayingBar player={player} />);
    act(() => player.load(TRACK));
    expect(screen.queryByRole('complementary', { name: 'Now playing' })).toBeNull();
  });

  it('carries on what plays after its page is left, linking back to it', async () => {
    render(<NowPlayingBar player={player} />);
    let leave: () => void = () => undefined;
    act(() => {
      player.load(TRACK);
      leave = player.view(TRACK.src);
      player.play();
    });
    expect(screen.queryByRole('complementary', { name: 'Now playing' })).toBeNull();

    act(() => leave());
    expect(screen.getByRole('link', { name: 'Stocks and flows' }).getAttribute('href')).toBe('/documents/tis/read/ch01');
    expect(document.documentElement.hasAttribute(NOW_PLAYING_ATTR)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(player.getState().playing).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Ahead 30 seconds' }));
    expect(player.element.currentTime).toBe(30);
  });

  it('keeps its room after a page swap resets the root, and gives it back when stopped', async () => {
    render(<NowPlayingBar player={player} />);
    act(() => {
      player.load(TRACK);
      player.play();
    });
    document.documentElement.removeAttribute(NOW_PLAYING_ATTR);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(document.documentElement.hasAttribute(NOW_PLAYING_ATTR)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Stop and close' }));
    expect(screen.queryByRole('complementary', { name: 'Now playing' })).toBeNull();
    expect(player.getState().track).toBeNull();
    expect(document.documentElement.hasAttribute(NOW_PLAYING_ATTR)).toBe(false);
  });
});
