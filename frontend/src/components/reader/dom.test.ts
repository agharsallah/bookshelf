// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markSpeaking, SOURCE_ATTR, SPEAKING_ATTR } from './dom';
import { actionFor } from './shortcuts';

function page(...anchors: string[]): HTMLElement {
  const root = document.createElement('article');
  for (const anchor of anchors) {
    const block = document.createElement('p');
    block.setAttribute(SOURCE_ATTR, anchor);
    block.scrollIntoView = vi.fn();
    root.append(block);
  }
  return root;
}

const block = (root: HTMLElement, anchor: string) => root.querySelector<HTMLElement>(`[${SOURCE_ATTR}="${anchor}"]`)!;
const place = (el: HTMLElement, top: number) =>
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 40 } as DOMRect);

afterEach(() => vi.restoreAllMocks());

describe('markSpeaking', () => {
  it('marks one block at a time, and none when reading stops', () => {
    const root = page('ch01/p001', 'ch01/p002');
    markSpeaking(root, 'ch01/p001', false);
    markSpeaking(root, 'ch01/p002', false);
    expect(root.querySelectorAll(`[${SPEAKING_ATTR}]`)).toHaveLength(1);
    expect(block(root, 'ch01/p002').hasAttribute(SPEAKING_ATTR)).toBe(true);
    markSpeaking(root, null, false);
    expect(root.querySelectorAll(`[${SPEAKING_ATTR}]`)).toHaveLength(0);
  });

  it('follows the voice only when the block has left the reading area', () => {
    window.innerHeight = 1000;
    const root = page('ch01/p001', 'ch01/p002');
    place(block(root, 'ch01/p001'), 300);
    place(block(root, 'ch01/p002'), 1400);
    markSpeaking(root, 'ch01/p001', true);
    markSpeaking(root, 'ch01/p002', false);
    expect(block(root, 'ch01/p001').scrollIntoView).not.toHaveBeenCalled();
    expect(block(root, 'ch01/p002').scrollIntoView).not.toHaveBeenCalled();
    markSpeaking(root, 'ch01/p002', true);
    expect(block(root, 'ch01/p002').scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
  });

  it('ignores a passage that is not on the page', () => {
    expect(() => markSpeaking(page('ch01/p001'), 'ch09/p001', true)).not.toThrow();
  });
});

describe('the listen shortcut', () => {
  it('is l, unmodified', () => {
    expect(actionFor({ key: 'l', metaKey: false, ctrlKey: false, altKey: false })).toBe('listen');
    expect(actionFor({ key: 'l', metaKey: true, ctrlKey: false, altKey: false })).toBeNull();
  });
});
