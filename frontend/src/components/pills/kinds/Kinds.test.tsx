import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePill } from '../../../lib/pills/testing/fixtures';
import type { Pill, PillKind } from '../../../lib/pills/types';
import type { RecallApi } from '../../recall/api';
import { PillCard } from '../PillCard';
import type { KindContext } from './context';
import { PillBody } from './index';

function context(overrides: Partial<KindContext> = {}): KindContext & { onAnswer: ReturnType<typeof vi.fn>; onMagnify: ReturnType<typeof vi.fn> } {
  const reviewApi = { get: vi.fn(), put: vi.fn(), delete: vi.fn(), post: vi.fn(async () => ({ id: 'r', due: '', last_rating: 3 })) };
  return { mediaBase: '/api', onAnswer: vi.fn(), onMagnify: vi.fn(), reviewApi: reviewApi as unknown as RecallApi, ...overrides } as never;
}

describe('quiz pills', () => {
  it('are answered in place: the pick is reported once, the right answer marked, the explanation shown', async () => {
    const ctx = context();
    render(<PillBody pill={makePill('quiz')} ctx={ctx} />);
    expect(screen.queryByRole('status')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Its goal' }));
    expect(ctx.onAnswer).toHaveBeenCalledWith({ correct: false, choice: 2 });
    expect(screen.getByRole('status').textContent).toMatch(/Not quite\..*Only inflows and outflows change a stock/);
    expect(screen.getByRole('button', { name: 'Its flows' }).dataset.state).toBe('right');
    await userEvent.click(screen.getByRole('button', { name: 'Its flows' }));
    expect(ctx.onAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('flip pills', () => {
  it('turn on a tap, then ask whether you knew it', async () => {
    const ctx = context();
    render(<PillBody pill={makePill('flip')} ctx={ctx} />);
    expect(screen.queryByText(/pulls a stock toward a goal/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /What is a balancing loop/ }));
    expect(screen.getByText(/pulls a stock toward a goal/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Missed it' }));
    expect(ctx.onAnswer).toHaveBeenCalledWith({ correct: false });
    expect(screen.getByRole('status').textContent).toMatch(/come back for review/);
  });
});

describe('review pills', () => {
  it('reveal the answer, then rate the review item through the review path', async () => {
    const ctx = context();
    const pill = makePill('review');
    render(<PillBody pill={pill} ctx={ctx} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Show the answer' }).disabled).toBe(true); // an attempt first
    await userEvent.type(screen.getByRole('textbox'), 'balancing, reinforcing');
    await userEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(screen.getByText('Balancing and reinforcing.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Good' }));
    expect(ctx.reviewApi.post).toHaveBeenCalledWith(`reviews/${pill.review_item_id}/rating`, { rating: 3, answer: 'balancing, reinforcing' });
    expect(ctx.onAnswer).toHaveBeenCalledWith({ correct: true, rating: 3 });
  });
});

describe('media pills', () => {
  it('magnify a figure crop in the lightbox, from under the API base', async () => {
    const ctx = context();
    render(<PillBody pill={makePill('figure')} ctx={ctx} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/media/meadows-systems/fig-1-1.png');
    await userEvent.click(screen.getByRole('button', { name: /Magnify/ }));
    expect(ctx.onMagnify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', src: '/api/media/meadows-systems/fig-1-1.png' }));
  });

  it('never autoplay a listening clip, and play only its slice', () => {
    const { container } = render(<PillBody pill={makePill('listen')} ctx={context()} />);
    const audio = container.querySelector('audio')!;
    expect(audio.autoplay).toBe(false);
    expect(audio.getAttribute('preload')).toBe('none');
    expect(audio.getAttribute('src')).toBe('/api/audio/files/meadows-systems/summary/default.mp3#t=12,31');
  });

  it('hold back a hook’s payoff until asked', async () => {
    render(<PillBody pill={makePill('hook')} ctx={context()} />);
    expect(screen.queryByText(/already old/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tell me' }));
    expect(screen.getByText(/already old/)).toBeTruthy();
  });
});

describe('every published example', () => {
  const file = resolve(__dirname, '../../../../../contracts/pill.examples.json');
  const examples = Object.values((JSON.parse(readFileSync(file, 'utf8')) as { examples: Record<string, Pill> }).examples);

  it.each(examples.map((e) => [e.kind as PillKind, e] as const))('renders the %s example as an article with its source', (_kind, pill) => {
    render(
      <PillCard pill={pill} ctx={context()} saved={false} reacted={null} onSave={vi.fn()} onReact={vi.fn()} onOpenSource={vi.fn()} position={0} setSize={10} />,
    );
    const article = screen.getByRole('article');
    expect(article.textContent).toContain(pill.document.title);
    expect(article.getAttribute('data-kind')).toBe(pill.kind);
  });
});
