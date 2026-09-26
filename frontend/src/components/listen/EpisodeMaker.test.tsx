// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobAccepted } from '../../lib/api/types/jobs';
import { EpisodeMaker } from './EpisodeMaker';
import { CATALOGUE, PARAMS } from './fixtures';

function setup(existing: string[] = []) {
  const accepted = { job: { id: 'j1' }, deduplicated: false } as unknown as JobAccepted;
  const api = { post: vi.fn().mockResolvedValue(accepted), delete: vi.fn() };
  const onQueued = vi.fn();
  render(<EpisodeMaker documentId="doc" catalogue={CATALOGUE} params={PARAMS} existing={existing} onQueued={onQueued} api={api} />);
  return { api, onQueued };
}

const castSelects = () => within(screen.getByRole('group', { name: 'Voices' })).getAllByRole('combobox');

describe('EpisodeMaker', () => {
  it('starts from the defaults: 15 minutes, two hosts, English, Alice and Frank', () => {
    setup();
    expect((screen.getByRole('radio', { name: /^15 min/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Conversation/ }) as HTMLInputElement).checked).toBe(true);
    expect(castSelects().map((s) => (s as HTMLSelectElement).value)).toEqual(['alice', 'frank']);
  });

  it('asks for one voice per speaker of the format', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: /Roundtable/ }));
    expect(castSelects()).toHaveLength(4);
    await userEvent.click(screen.getByRole('radio', { name: /Narrator/ }));
    expect(castSelects()).toHaveLength(1);
  });

  it('queues the script with the chosen length, format, language and cast', async () => {
    const { api, onQueued } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /^5 min/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Panel/ }));
    await userEvent.selectOptions(castSelects()[2]!, 'carter');
    await userEvent.click(screen.getByRole('button', { name: 'Write and record' }));
    expect(api.post).toHaveBeenCalledWith('jobs', {
      kind: 'derive',
      document_id: 'doc',
      skill: 'write-audio-summary',
      params: { minutes: 5, format: 'panel', language: 'en' },
      voices: ['alice', 'frank', 'carter'],
      force: false,
    });
    expect(onQueued).toHaveBeenCalledWith({ id: 'j1' });
  });

  it('casts Mandarin voices first for a Chinese episode', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: /中文/ }));
    expect((castSelects()[0] as HTMLSelectElement).value).toBe('xinran');
  });

  it('offers to record an existing episode again with a new cast', () => {
    setup(['15m-conversation-en']);
    expect(screen.getByRole('button', { name: 'Record it with these voices' })).toBeTruthy();
  });

  it('says why it could not queue', async () => {
    const api = { post: vi.fn().mockRejectedValue(new Error('No voice called "x".')), delete: vi.fn() };
    render(<EpisodeMaker documentId="doc" catalogue={CATALOGUE} params={PARAMS} existing={[]} onQueued={vi.fn()} api={api} />);
    await userEvent.click(screen.getByRole('button', { name: 'Write and record' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not queue it');
  });
});
