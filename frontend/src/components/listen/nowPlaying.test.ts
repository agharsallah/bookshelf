// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NowPlaying, type Track } from './nowPlaying';

const track = (name: string): Track => ({ src: `/${name}.mp3`, title: name, bookTitle: 'Book', sections: [], duration: 100, storageKey: `k:${name}`, href: '/' });

let player: NowPlaying;
beforeEach(() => {
  localStorage.clear();
  player = new NowPlaying(document.createElement('audio'), () => localStorage);
  Object.defineProperty(player.element, 'duration', { configurable: true, value: 100 });
});

describe('NowPlaying', () => {
  it('keeps each recording’s place when switching between them', () => {
    player.load(track('a'));
    player.element.currentTime = 40;
    player.load(track('b'));
    expect(localStorage.getItem('k:a')).toBe('40');

    // Switching pauses the old one at 0 of the new: that must not forget b's place.
    localStorage.setItem('k:b', '25');
    player.element.dispatchEvent(new Event('pause'));
    expect(localStorage.getItem('k:b')).toBe('25');
  });

  it('starts where you seek before the recording has loaded, not where you stopped', () => {
    localStorage.setItem('k:a', '62');
    player.load(track('a'));
    player.seek(12);
    player.element.dispatchEvent(new Event('loadedmetadata'));
    expect(player.element.currentTime).toBe(12);
  });

  it('reloading the one already loaded changes nothing but its details', () => {
    const listener = vi.fn();
    player.load({ ...track('a'), href: '/first' });
    player.subscribe(listener);
    player.load({ ...track('a'), title: 'Renamed', href: '/second' });
    expect(player.getState().track).toMatchObject({ title: 'Renamed', href: '/first' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the speed across recordings', () => {
    player.setRate(1.5);
    player.load(track('a'));
    expect(player.element.playbackRate).toBe(1.5);
  });
});
