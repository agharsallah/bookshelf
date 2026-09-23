import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as MermaidModule from '../../../lib/mermaid';
import { artifact } from '../fixtures';
import { ProofView } from '../evidence/ProofView';
import { emptyPage, fakeApi } from '../testing/fakeApi';
import { ArtifactDetail } from './ArtifactDetail';

vi.mock('../../../lib/mermaid', async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidModule>()),
  renderDiagram: () => Promise.resolve('<svg></svg>'),
}));
vi.mock('../../../lib/highlight', () => ({ highlightCode: () => Promise.resolve('<pre></pre>') }));

const note = artifact({
  id: 'note',
  body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Stocks lag flows.', cites: ['ch01/s01/p001'] }] }] },
});

describe('<ArtifactDetail> editing', () => {
  it('saves the corrected body as {action: "edit", body} and shows the new version', async () => {
    const { api, calls } = fakeApi({
      'GET documents/doc1/blocks': () => ({ ...emptyPage, items: [{ id: 'n1', anchor: 'ch01/s01/p002', kind: 'paragraph', heading: null, text: 'Stocks change only through flows.', page_from: 3, page_to: 3, meta: {} }], total: 1 }),
      'POST artifacts/note/review': (call) => ({ ...note, id: 'note-v2', version: 2, origin: 'human', review: 'approved', body: (call.body as { body: unknown }).body }),
    });
    const user = userEvent.setup();
    render(<ArtifactDetail artifact={note} versions={[note]} documentTitle="Systems" skills={[]} initialMode="edit" api={api} navigate={vi.fn()} />);

    const text = screen.getByRole('textbox', { name: 'Text text' });
    await user.clear(text);
    await user.type(text, 'Stocks lag behind their flows.');
    await user.type(screen.getByRole('combobox', { name: 'Add a cite to Text' }), 'only through');
    await user.click(await screen.findByRole('option', { name: /Stocks change only through flows/ }));
    await user.click(screen.getByRole('button', { name: 'Save as a new version' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toEqual({
        method: 'POST',
        path: 'artifacts/note/review',
        body: {
          action: 'edit',
          body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Stocks lag behind their flows.', cites: ['ch01/s01/p001', 'ch01/s01/p002'] }] }] },
        },
      }),
    );
    expect(await screen.findByText(/Saved as version 2, written by you/)).toBeTruthy();
  });

  it('will not save a body that breaks the block contract', async () => {
    const { api } = fakeApi({ 'GET documents/doc1/blocks': () => emptyPage });
    const user = userEvent.setup();
    render(<ArtifactDetail artifact={note} versions={[note]} documentTitle="Systems" skills={[]} initialMode="edit" api={api} navigate={vi.fn()} />);
    await user.clear(screen.getByRole('textbox', { name: 'Text text' }));
    expect(screen.getByText('The paragraph is empty.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save as a new version' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('<ProofView>', () => {
  it('marks uncited spans and counts them', () => {
    const { container } = render(
      <ProofView
        blocks={[
          { type: 'paragraph', spans: [{ text: 'Grounded claim.', cites: ['ch01/p001'] }, { text: 'Unsupported claim.', cites: [] }] },
          { type: 'quote', text: 'Verbatim.', cites: [], page: 3 },
        ]}
      />,
    );
    const marked = [...container.querySelectorAll('[data-uncited]')].map((el) => el.textContent);
    expect(marked).toEqual(['Unsupported claim. uncited']);
    expect(screen.getByRole('status').textContent).toBe('1 of 3 claims cite a source. 2 uncited, underlined below.');
    expect(screen.getByText('No source cited for this quote.')).toBeTruthy();
  });
});
