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

describe('<ArtifactDetail> writing by hand', () => {
  // The backend checks a hand-written body against the producing skill's schema
  // (structure-note requires tags and concepts) and links it to its note by note_id.
  it('posts a new structured note in the skill\'s shape, linked to its note', async () => {
    const structured = artifact({
      id: 'sn1',
      type: 'structured_note',
      skill: 'structure-note',
      anchor: 'ch01/s01/p001',
      note_id: 'note-7',
      body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Model words.', cites: ['ch01/s01/p001'] }] }], tags: ['stocks'], concepts: ['flow'] },
    });
    const { api, calls } = fakeApi({ 'GET documents/doc1/blocks': () => emptyPage, 'POST artifacts': () => ({ ...structured, id: 'sn2' }) });
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<ArtifactDetail artifact={structured} versions={[structured]} documentTitle="Systems" skills={[]} initialMode="write" api={api} navigate={navigate} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Insert a block at position 1' }), 'paragraph');
    await user.type(screen.getByRole('textbox', { name: 'Text text' }), 'My own words.');
    await user.click(screen.getByRole('button', { name: 'Save and approve' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/review/sn2'));
    const post = calls.find((c) => c.method === 'POST' && c.path === 'artifacts');
    expect(post?.body).toMatchObject({ type: 'structured_note', note_id: 'note-7', body: { tags: ['stocks'], concepts: ['flow'] } });
    expect((post?.body as { body: { blocks: unknown[] } }).body.blocks).toHaveLength(1);
  });
});

describe('<ArtifactDetail> verdicts and re-runs', () => {
  it('re-runs a quiz through derive with its skill, forced', async () => {
    const quiz = artifact({ id: 'quiz', type: 'quiz', skill: 'make-quiz', anchor: 'ch03', body: { items: [] } });
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job: { id: 'j1' }, deduplicated: false }) });
    render(<ArtifactDetail artifact={quiz} versions={[quiz]} documentTitle="Systems" skills={[]} api={api} navigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Re-run' }));
    await waitFor(() =>
      expect(calls).toEqual([{ method: 'POST', path: 'jobs', body: { kind: 'derive', document_id: 'doc1', anchor: 'ch03', skill: 'make-quiz', force: true } }]),
    );
    expect(await screen.findByText(/Queued make-quiz for ch03/)).toBeTruthy();
  });

  it('sends an approved artifact back to draft with reopen', async () => {
    const approved = artifact({ id: 'done', review: 'approved' });
    const { api, calls } = fakeApi({ 'POST artifacts/done/review': () => ({ ...approved, review: 'draft' }) });
    render(<ArtifactDetail artifact={approved} versions={[approved]} documentTitle="Systems" skills={[]} api={api} navigate={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Back to draft' }));
    await waitFor(() => expect(calls.map((c) => c.body)).toEqual([{ action: 'reopen' }]));
    expect(await screen.findByText(/Back to draft\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to draft' })).toBeNull();
  });

  it('marks a version a newer live one replaces as superseded', () => {
    const v1 = artifact({ id: 'v1', version: 1 });
    const v2 = artifact({ id: 'v2', version: 2, origin: 'human', review: 'approved' });
    render(<ArtifactDetail artifact={v1} versions={[v1, v2]} documentTitle="Systems" skills={[]} api={fakeApi().api} navigate={vi.fn()} />);
    expect(screen.getByText('Superseded')).toBeTruthy();
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
