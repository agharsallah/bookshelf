// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BAR_DELAY_MS, BAR_FINISH_MS, SKELETON_DELAY_MS, skeletonFor, trackNavigation } from './navigation-loading';

describe('skeletonFor', () => {
  it.each([
    ['/documents/flow/read/ch01', 'reader'],
    ['/documents/flow/read/ch01/p003', 'reader'],
    ['/documents/flow/read', 'reader'],
    ['/documents/flow', 'document'],
    ['/documents/flow/', 'document'],
    ['/documents/flow/guide', 'document'],
    ['/documents/reader-notes', 'document'],
    ['/library', 'grid'],
    ['/papers/', 'grid'],
    ['/collections', 'grid'],
    ['/you', 'grid'],
    ['/you/flow', 'page'],
    ['/pipeline', 'page'],
    ['/', 'page'],
  ])('%s opens on the %s skeleton', (path, kind) => {
    expect(skeletonFor(path)).toBe(kind);
  });
});

describe('trackNavigation', () => {
  // One document for the file, as in the app: each test starts from a clean page.
  trackNavigation(document);

  const bar = () => document.querySelector<HTMLElement>('[data-nav-progress]')!;
  const main = () => document.getElementById('main')!;
  const navigating = () => document.documentElement.dataset.navigating;

  function navigate(to: string) {
    document.dispatchEvent(Object.assign(new Event('astro:before-preparation'), { to: new URL(to, 'http://localhost') }));
  }
  const arrive = () => document.dispatchEvent(new Event('astro:after-preparation'));
  const swap = () => document.dispatchEvent(new Event('astro:after-swap'));

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div data-nav-progress></div><main id="main"></main>';
    delete document.documentElement.dataset.navigating;
  });
  afterEach(() => {
    arrive();
    swap();
    vi.useRealTimers();
  });

  it('shows nothing when the page arrives quickly', () => {
    navigate('/library');
    vi.advanceTimersByTime(BAR_DELAY_MS - 1);
    arrive();
    vi.advanceTimersByTime(SKELETON_DELAY_MS * 2);
    expect(bar().dataset.state).toBeUndefined();
    expect(navigating()).toBeUndefined();
  });

  it('starts the bar, then the skeleton shaped like the page being opened', () => {
    navigate('/documents/flow/read/ch02');
    vi.advanceTimersByTime(BAR_DELAY_MS);
    expect(bar().dataset.state).toBe('loading');
    expect(navigating()).toBeUndefined();

    vi.advanceTimersByTime(SKELETON_DELAY_MS - BAR_DELAY_MS);
    expect(navigating()).toBe('reader');
    expect(main().getAttribute('aria-busy')).toBe('true');
  });

  it('finishes the bar when the page arrives and keeps the skeleton until the swap', () => {
    navigate('/library');
    vi.advanceTimersByTime(SKELETON_DELAY_MS);
    arrive();
    expect(bar().dataset.state).toBe('done');
    expect(navigating()).toBe('grid');

    swap();
    expect(navigating()).toBeUndefined();
    expect(main().hasAttribute('aria-busy')).toBe(false);
    vi.advanceTimersByTime(BAR_FINISH_MS);
    expect(bar().dataset.state).toBeUndefined();
  });

  it('starts over when another link is followed before the first page arrives', () => {
    navigate('/library');
    vi.advanceTimersByTime(SKELETON_DELAY_MS);
    navigate('/pipeline');
    expect(navigating()).toBeUndefined();
    vi.advanceTimersByTime(SKELETON_DELAY_MS);
    expect(navigating()).toBe('page');
  });
});
