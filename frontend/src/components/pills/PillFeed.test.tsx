import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PillsClient } from '../../lib/pills/client';
import { defaultConfig } from '../../lib/pills/config';
import { memoryStorage } from '../../lib/pills/storage';
import { makePage, makePill, makeStart, makeThread } from '../../lib/pills/testing/fixtures';
import type { Pill, PillEvent, SessionSummary, Supply } from '../../lib/pills/types';
import type { RecallApi } from '../recall/api';
import { PillFeed } from './PillFeed';
import { SupplyPanel } from './SupplyPanel';

const SUMMARY: SessionSummary = {
  seen: 2,
  saved: 1,
  answered: 1,
  correct: 1,
  due_tomorrow: 3,
  minutes: 4,
  next_read: { document: { id: 'd', slug: 'meadows-systems', title: 'Thinking in Systems' }, anchor: 'ch07', title: 'Chapter 7' },
};

function fakeClient(pills: Pill[]) {
  const client = {
    startSession: vi.fn(async () => makeStart(pills, null)),
    page: vi.fn(async () => makePage([], null)),
    finish: vi.fn(async () => SUMMARY),
    sendEvents: vi.fn(async (events: readonly PillEvent[]) => ({ accepted: events.length, duplicates: 0, ignored: 0 })),
    supply: vi.fn(),
    generate: vi.fn(),
    rebuild: vi.fn(),
    pill: vi.fn(),
    feeds: vi.fn(async () => []),
    createFeed: vi.fn(),
    updateFeed: vi.fn(),
    deleteFeed: vi.fn(),
  };
  return client as typeof client & PillsClient;
}

function renderFeed(pills: Pill[]) {
  const client = fakeClient(pills);
  render(
    <PillFeed
      initialConfig={{ ...defaultConfig(), length: 10 }}
      options={{ documents: [], collections: [], paperSets: [] }}
      feeds={[]}
      client={client}
      reviewApi={{} as RecallApi}
      storage={memoryStorage()}
    />,
  );
  return client;
}

const progress = () => screen.getByRole('progressbar').getAttribute('aria-valuenow');
const sentKinds = (client: ReturnType<typeof fakeClient>) => client.sendEvents.mock.calls.flatMap(([events]) => events.map((e) => e.kind));

describe('<PillFeed>', () => {
  it('starts a session from the config and shows each pill as an article', async () => {
    const pills = [makePill('insight'), makePill('quiz')] as Pill[];
    const client = renderFeed(pills);
    await screen.findAllByRole('article');
    expect(client.startSession).toHaveBeenCalledWith({ config: { ...defaultConfig(), length: 10 } });
    expect(screen.getByRole('feed')).toBeTruthy();
    expect(progress()).toBe('1');
  });

  it('moves with j / k and, inside a thread, with the arrow keys', async () => {
    renderFeed([makePill('insight') as Pill, ...makeThread('t1', 3, 'Feedback')]);
    await screen.findAllByRole('article');
    await userEvent.keyboard('j');
    expect(progress()).toBe('2');
    expect(screen.getByText('Feedback · 1 of 3')).toBeTruthy();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText('Feedback · 3 of 3')).toBeTruthy();
    expect(progress()).toBe('4');
    await userEvent.keyboard('{ArrowLeft}k');
    expect(progress()).toBe('1');
  });

  it('saves with s and the rail, sending the events before the session is closed on Escape', async () => {
    const pills = [makePill('insight'), makePill('remember')] as Pill[];
    const client = renderFeed(pills);
    await screen.findAllByRole('article');
    await userEvent.keyboard('s');
    const [first] = screen.getAllByRole('button', { name: /^Saved/ });
    expect(first?.getAttribute('aria-pressed')).toBe('true');
    await userEvent.keyboard('{Escape}');
    await screen.findByRole('heading', { name: 'That’s the session' });
    expect(client.finish).toHaveBeenCalledTimes(1);
    expect(client.sendEvents.mock.invocationCallOrder[0]).toBeLessThan(client.finish.mock.invocationCallOrder[0]!);
    expect(sentKinds(client)).toEqual(expect.arrayContaining(['seen', 'save']));
    const saved = client.sendEvents.mock.calls.flatMap(([events]) => events).find((e) => e.kind === 'save');
    expect(saved).toMatchObject({ pill_id: pills[0]!.id, session_id: makeStart([]).session.id });
  });

  it('ends on a summary with where to continue reading', async () => {
    renderFeed([makePill('insight') as Pill]);
    await screen.findAllByRole('article');
    await userEvent.keyboard('j');
    await screen.findByRole('heading', { name: 'That’s the session' });
    expect(screen.getByText('1/1')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Continue reading/ }).getAttribute('href')).toBe('/documents/meadows-systems/read/ch07');
  });

  it('reports a quiz answer as an event', async () => {
    const quiz = makePill('quiz') as Pill;
    const client = renderFeed([quiz]);
    await screen.findAllByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Its flows' }));
    await userEvent.click(screen.getByRole('button', { name: 'End' }));
    await screen.findByRole('heading', { name: 'That’s the session' });
    const answer = client.sendEvents.mock.calls.flatMap(([events]) => events).find((e) => e.kind === 'answer');
    expect(answer).toMatchObject({ pill_id: quiz.id, value: { correct: true, choice: 0 } });
  });

  it('says why the feed could not start', async () => {
    const client = fakeClient([]);
    client.startSession.mockRejectedValueOnce(new Error('API down'));
    render(<PillFeed initialConfig={defaultConfig()} options={{ documents: [], collections: [], paperSets: [] }} feeds={[]} client={client} storage={memoryStorage()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/API down/));
  });
});

describe('<SupplyPanel>', () => {
  const supply: Supply = {
    unseen: 12,
    low: true,
    by_document: [
      { document: { id: 'd1', slug: 'meadows-systems', title: 'Thinking in Systems' }, unseen: 12, generatable: [{ anchor: 'ch04', title: 'Delays', estimate_tokens: 12_400 }, { anchor: 'ch05', title: null, estimate_tokens: null }], undistilled: false },
      { document: { id: 'd2', slug: 'new-book', title: 'A New Book' }, unseen: 0, generatable: [], undistilled: true },
    ],
  };

  it('shows the token estimate of each chapter before making pills; names undistilled books', async () => {
    const onGenerate = vi.fn(async () => ({ jobs: ['j1'], estimate_tokens: 12_400 }));
    render(<SupplyPanel supply={supply} onGenerate={onGenerate} />);
    expect(screen.getByText(/running low/)).toBeTruthy();
    expect(screen.getByText('Delays')).toBeTruthy();
    expect(screen.getByText('Chapter 5')).toBeTruthy(); // no heading: its number
    expect(screen.getByText('about 12.4k tokens')).toBeTruthy();
    expect(screen.getByText('no estimate yet')).toBeTruthy();
    expect(screen.getByText(/No distillation yet, so no pills: A New Book/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Make pills' })[0]!);
    expect(onGenerate).toHaveBeenCalledWith('d1', 'ch04');
    expect(await screen.findByText('Queued')).toBeTruthy();
  });
});
