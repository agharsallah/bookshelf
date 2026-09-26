// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './AudioPlayer';
import { EPISODE } from './fixtures';

const RENDER = EPISODE.renders[0]!;

function setup(onTime = vi.fn()) {
  const audio = createRef<HTMLAudioElement>();
  render(
    <AudioPlayer
      audio={audio}
      src="/api/audio/files/doc/art-1/r1.mp3"
      downloadHref="/api/audio/files/doc/art-1/r1.mp3?download=Book.mp3"
      downloadName="Book.mp3"
      title="Why busy teams are slow"
      bookTitle="Queueing"
      sections={RENDER.sections}
      duration={RENDER.duration}
      storageKey="bookshelf:listen:r1"
      onTime={onTime}
    />,
  );
  const el = audio.current!;
  Object.defineProperty(el, 'duration', { configurable: true, value: 100 });
  return { el, onTime };
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
  it('plays and pauses, and says which it will do', async () => {
    const { el } = setup();
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
    fireEvent.timeUpdate(el);
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

  it('offers the MP3 as a download', () => {
    setup();
    const link = screen.getByRole('link', { name: 'Download MP3' });
    expect(link.getAttribute('download')).toBe('Book.mp3');
    expect(link.getAttribute('href')).toContain('download=Book.mp3');
  });
});
