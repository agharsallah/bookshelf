// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api/client';
import type { ChapterAudio } from '../../lib/api/types/audio';
import type { JobAccepted, JobPublic } from '../../lib/api/types/jobs';
import { ChapterListen } from './ChapterListen';
import { CATALOGUE, CHAPTER_AUDIO, READING_ORDER } from './fixtures';

// The live job stream, as the test sets it (no EventSource in tests).
const stream = vi.hoisted(() => ({ jobs: {} as Record<string, JobPublic>, track: vi.fn() }));
vi.mock('../../lib/hooks/useJobStream', () => ({
  useJobStream: () => ({ jobs: stream.jobs, queue: null, track: stream.track }),
}));

const UNRECORDED: ChapterAudio = { ...CHAPTER_AUDIO, renders: [] };

const reading = (state: JobPublic['state']): JobPublic =>
  ({ id: 'j1', kind: 'narrate', document_id: 'doc', anchor: 'ch01', skill: null, state, payload: { anchor: 'ch01', voices: ['maya'] }, created_at: '2026-09-27T10:00:00Z' }) as unknown as JobPublic;

function setup({ chapter = CHAPTER_AUDIO, activeAnchor = null as string | null } = {}) {
  const chapters = [chapter];
  const get = vi.fn((path: string): Promise<unknown> => Promise.resolve(path === 'audio/voices' ? CATALOGUE : (chapters.shift() ?? chapter)));
  const post = vi.fn().mockResolvedValue({ job: reading('queued'), deduplicated: false } as JobAccepted);
  const api = { get, post, delete: vi.fn() } as unknown as ApiClient;
  const onSpeaking = vi.fn();
  const props = { documentId: 'doc', bookTitle: 'Thinking in Systems', anchor: 'ch01', chapter: 'Stocks and flows', activeAnchor, order: READING_ORDER, onSpeaking, onClose: vi.fn(), api };
  const view = render(<ChapterListen {...props} />);
  return { api, get, post, onSpeaking, props, chapters, unmount: view.unmount, rerender: () => view.rerender(<ChapterListen {...props} />) };
}

const audioElement = () => document.querySelector('audio')!;

beforeEach(() => {
  stream.jobs = {};
  stream.track.mockReset();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('ChapterListen', () => {
  it('loads the chapter read aloud from its anchor, and tells how long it takes', async () => {
    const { get } = setup();
    await screen.findByRole('button', { name: 'Play' });
    expect(get).toHaveBeenCalledWith('documents/doc/audio/read/ch01');
    expect(screen.getByText('Listen · About 3 min')).toBeTruthy();
    expect(audioElement().getAttribute('src')).toBe('/api/audio/files/doc/read~ch01/read-1.mp3');
  });

  it('records an unrecorded chapter with the voice you choose', async () => {
    const { post } = setup({ chapter: UNRECORDED });
    const voice = await screen.findByRole('combobox');
    expect((voice as HTMLSelectElement).value).toBe('alice');
    expect(screen.getByText(/Not recorded yet/)).toBeTruthy();

    await userEvent.selectOptions(voice, 'maya');
    await userEvent.click(screen.getByRole('button', { name: 'Read it aloud' }));

    expect(post).toHaveBeenCalledWith('jobs', { kind: 'narrate', document_id: 'doc', anchor: 'ch01', voices: ['maya'] });
    expect(stream.track).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1' }));
  });

  it('shows a recording in the works, and plays it in place once it is done', async () => {
    stream.jobs = { j1: reading('running') };
    const { rerender, chapters } = setup({ chapter: UNRECORDED });
    expect(await screen.findByText('Reading ch01 aloud with Maya')).toBeTruthy();
    expect(screen.getByText(/Recording now/)).toBeTruthy();

    chapters.push(CHAPTER_AUDIO);
    stream.jobs = { j1: reading('done') };
    rerender();

    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read it aloud' })).toBeNull();
  });

  it('marks the passage being read as it plays, and nothing once closed', async () => {
    const { onSpeaking, unmount } = setup();
    await screen.findByRole('button', { name: 'Play' });
    const el = audioElement();

    el.currentTime = 5;
    fireEvent.timeUpdate(el);
    expect(onSpeaking).toHaveBeenLastCalledWith('ch01/p001', true);
    el.currentTime = 6;
    fireEvent.timeUpdate(el);
    expect(onSpeaking).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('checkbox', { name: /Follow along/ }));
    el.currentTime = 15;
    fireEvent.timeUpdate(el);
    expect(onSpeaking).toHaveBeenLastCalledWith('ch01/s01/p002', false);

    unmount();
    expect(onSpeaking).toHaveBeenLastCalledWith(null, false);
  });

  it('plays from the passage you are at (or the next one read)', async () => {
    setup({ activeAnchor: 'ch01/s01/c001' });
    await userEvent.click(await screen.findByRole('button', { name: 'Play from where I am' }));
    expect(audioElement().currentTime).toBe(12);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('offers another voice for a chapter already recorded', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Another voice' }));
    expect(screen.getByRole('button', { name: 'Read it aloud' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Read it aloud' })).toBeNull();
  });

  it('says so when a chapter has nothing to read aloud', async () => {
    setup({ chapter: { ...UNRECORDED, script: { title: 'Code', speakers: [{ role: 'reader' }], sections: [] }, words: 0 } });
    expect(await screen.findByText(/nothing to read aloud/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read it aloud' })).toBeNull();
  });

  it('says so when the audio cannot be loaded', async () => {
    const { api, get } = setup();
    get.mockRejectedValue(new Error('offline'));
    render(<ChapterListen documentId="doc" bookTitle="B" anchor="ch02" chapter="C" activeAnchor={null} order={READING_ORDER} onSpeaking={vi.fn()} onClose={vi.fn()} api={api} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be loaded'));
  });
});
