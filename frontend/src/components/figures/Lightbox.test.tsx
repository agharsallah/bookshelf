import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Lightbox, type LightboxItem } from './Lightbox';
import { FIT_PADDING } from './zoom';

const items: LightboxItem[] = [
  { id: 'f1', kind: 'image', src: '/api/media/f1.png', title: 'Figure 1.1 The loop', alt: 'A loop', meta: 'Page 3', anchor: 'ch01/f001' },
  { id: 'f2', kind: 'image', src: '/api/media/f2.png', title: 'Figure 1.2 The lag', alt: 'A lag', meta: 'Page 5', anchor: 'ch01/f002' },
];

// happy-dom lays nothing out: give the stage a size and the images a natural size.
const STAGE = { width: 1000 + 2 * FIT_PADDING, height: 800 + 2 * FIT_PADDING };
let restore: (() => void)[] = [];
function stub(proto: object, key: string, value: number) {
  const before = Object.getOwnPropertyDescriptor(proto, key);
  Object.defineProperty(proto, key, { configurable: true, get: () => value });
  restore.push(() => (before ? Object.defineProperty(proto, key, before) : Reflect.deleteProperty(proto, key)));
}
beforeEach(() => {
  stub(HTMLElement.prototype, 'clientWidth', STAGE.width);
  stub(HTMLElement.prototype, 'clientHeight', STAGE.height);
  stub(HTMLImageElement.prototype, 'naturalWidth', 2000);
  stub(HTMLImageElement.prototype, 'naturalHeight', 1000);
});
afterEach(() => {
  restore.forEach((r) => r());
  restore = [];
});

function Harness(props: { onClose?: () => void; onReveal?: (anchor: string) => void; start?: number }) {
  const [index, setIndex] = useState(props.start ?? 0);
  return <Lightbox items={items} index={index} onIndex={setIndex} onClose={props.onClose ?? (() => undefined)} onReveal={props.onReveal} />;
}

const dialog = () => screen.getByRole('dialog');
const loaded = () => act(() => void fireEvent.load(dialog().querySelector('img')!));
const percent = () => screen.getByRole('button', { name: /^Zoom \d+%/ }).textContent;

describe('<Lightbox>', () => {
  it('shows the figure with its caption, page and place among the chapter’s figures', () => {
    render(<Harness start={1} />);
    expect(screen.getByRole('dialog', { name: 'Figure 1.2 The lag' })).toBeTruthy();
    expect(within(dialog()).getByText('2 of 2')).toBeTruthy();
    expect(within(dialog()).getByText('Page 5')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open original' }).getAttribute('href')).toBe('/api/media/f2.png');
  });

  it('moves between figures with the arrows, the buttons and the thumbnails', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Next figure' }));
    expect(screen.getByRole('heading', { name: 'Figure 1.2 The lag' })).toBeTruthy();
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Figure 1.1 The loop' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '2: Figure 1.2 The lag' }));
    expect(screen.getByRole('button', { name: '2: Figure 1.2 The lag' }).getAttribute('aria-current')).toBe('true');
  });

  it('fits the figure to the screen, then zooms with the buttons and the keys', async () => {
    render(<Harness />);
    loaded();
    expect(percent()).toBe('50%');
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(percent()).toBe('70%');
    fireEvent.keyDown(dialog(), { key: '1' });
    expect(percent()).toBe('100%');
    expect(screen.getByRole('button', { name: '1:1' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(dialog(), { key: '0' });
    expect(percent()).toBe('50%');
    fireEvent.keyDown(dialog(), { key: '-' });
    expect(percent()).toBe('50%');
  });

  it('keeps its keys from reaching the page behind', () => {
    const onPageKey = vi.fn();
    document.addEventListener('keydown', onPageKey);
    render(<Harness />);
    fireEvent.keyDown(dialog(), { key: '+' });
    document.removeEventListener('keydown', onPageKey);
    expect(onPageKey).not.toHaveBeenCalled();
  });

  it('closes on Escape and hands focus back to what opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = render(<Harness onClose={onClose} />);
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('takes you to the figure’s passage', async () => {
    const onReveal = vi.fn();
    render(<Harness onReveal={onReveal} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show in text' }));
    expect(onReveal).toHaveBeenCalledWith('ch01/f001');
  });
});
