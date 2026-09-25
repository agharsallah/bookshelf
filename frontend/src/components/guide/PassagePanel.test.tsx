import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type * as MermaidModule from '../../lib/mermaid';
import { clearChapterCache } from './passage';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));
vi.mock('../../lib/mermaid', async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidModule>()),
  renderDiagram: () => Promise.reject(new Error('no mermaid in tests')),
}));

const { PassagePanel } = await import('./PassagePanel');
const { GuideBody } = await import('./GuideBody');

const leaf = (anchor: string, text: string, extra: Partial<TreeNode> = {}): TreeNode =>
  ({ id: anchor, anchor, kind: 'paragraph', ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text, page_from: 12, page_to: 12, meta: {}, children: [], ...extra }) as TreeNode;
const chapter = (anchor: string, heading: string, children: TreeNode[]): TreeNode => ({ ...leaf(anchor, ''), kind: 'chapter', heading, text: null, children });

const ch18 = chapter('ch18', 'Handling Sensitive Conversations', [
  leaf('ch18/p001', 'Opening paragraph.'),
  { ...leaf('ch18/s01', ''), kind: 'section', heading: 'Weaknesses', text: null, children: [leaf('ch18/s01/p001', 'Frame weaknesses honestly.')] },
]);
const units = [
  { anchor: 'ch17', heading: 'Toward Better Stories', label: '17' },
  { anchor: 'ch18', heading: 'Handling Sensitive Conversations', label: '18' },
  { anchor: 'ch19', heading: 'Managing the Human Element', label: '19' },
];
const readHref = (a: string) => `/documents/book/read/${a}`;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

beforeEach(() => {
  clearChapterCache();
  api.get.mockReset();
});

describe('<PassagePanel>', () => {
  it('opens the whole chapter at the cited block, marked, with its section named', async () => {
    api.get.mockResolvedValue({ node: ch18, truncated: false });
    render(<PassagePanel slug="book" units={units} target={{ unit: units[1]!, anchor: 'ch18/s01/p001' }} onTarget={vi.fn()} onClose={vi.fn()} readHref={readHref} />);

    const dialog = screen.getByRole('dialog', { name: 'Handling Sensitive Conversations' });
    await waitFor(() => expect(within(dialog).getByText('Frame weaknesses honestly.')).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith('nodes/book/ch18');
    expect(within(dialog).getByText('Opening paragraph.')).toBeTruthy();
    await waitFor(() => expect(dialog.querySelector('[data-cited]')?.getAttribute('data-source-anchor')).toBe('ch18/s01/p001'));
    expect(within(dialog).getByText(/Chapter 18/).textContent).toContain('Weaknesses');
    expect(within(dialog).getByRole('link', { name: 'Open in reader' }).getAttribute('href')).toBe('/documents/book/read/ch18/s01/p001');
  });

  it('browses to the chapters either side', async () => {
    api.get.mockResolvedValue({ node: ch18, truncated: false });
    const onTarget = vi.fn();
    render(<PassagePanel slug="book" units={units} target={{ unit: units[1]!, anchor: 'ch18' }} onTarget={onTarget} onClose={vi.fn()} readHref={readHref} />);

    await userEvent.click(screen.getByRole('button', { name: /19\. Managing the Human Element/ }));
    expect(onTarget).toHaveBeenCalledWith({ unit: units[2], anchor: 'ch19' });
    await userEvent.click(screen.getByRole('button', { name: /17\. Toward Better Stories/ }));
    expect(onTarget).toHaveBeenLastCalledWith({ unit: units[0], anchor: 'ch17' });
  });

  it('says so when the chapter cannot load, and retries on request', async () => {
    api.get.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ node: ch18, truncated: false });
    render(<PassagePanel slug="book" units={units} target={{ unit: units[1]!, anchor: 'ch18/p001' }} onTarget={vi.fn()} onClose={vi.fn()} readHref={readHref} />);

    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Opening paragraph.')).toBeTruthy();
  });
});

describe('<GuideBody>', () => {
  const sections = [
    { key: 'overview' as const, title: 'The book in brief', blocks: [{ type: 'paragraph' as const, spans: [{ text: 'Frame it.', cites: ['ch18/s01/p001'] }] }] },
  ];

  it('opens a cited passage in place on a plain click', async () => {
    api.get.mockResolvedValue({ node: ch18, truncated: false });
    render(<GuideBody slug="book" sections={sections} rows={[]} themes={[]} numbers={[]} units={units} />);

    await userEvent.click(screen.getByRole('link', { name: /source ch18\/s01\/p001/ }));
    expect(await screen.findByRole('dialog', { name: 'Handling Sensitive Conversations' })).toBeTruthy();
  });

  it('leaves ⌘-click to the browser (a new tab on the reader)', async () => {
    render(<GuideBody slug="book" sections={sections} rows={[]} themes={[]} numbers={[]} units={units} />);
    const chip = screen.getByRole('link', { name: /source ch18\/s01\/p001/ });
    expect(chip.getAttribute('href')).toBe('/documents/book/read/ch18/s01/p001');

    const user = userEvent.setup();
    await user.keyboard('{Meta>}');
    await user.click(chip);
    await user.keyboard('{/Meta}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives drawn figures a Magnify button that opens them in the lightbox', async () => {
    const map = {
      key: 'map' as const,
      title: 'The big picture',
      blocks: [{ type: 'diagram' as const, direction: 'TD' as const, nodes: [{ id: 'a', label: 'Decode' }], edges: [], cites: ['ch18/p001'] }],
    };
    render(<GuideBody slug="book" sections={[map]} rows={[]} themes={[]} numbers={[]} units={units} />);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    screen.getByRole('figure').prepend(svg); // Mermaid's drawing, which tests do not render
    await userEvent.click(screen.getByRole('button', { name: 'Magnify: Diagram' }));
    const lightbox = await screen.findByRole('dialog');
    expect(lightbox.textContent).toContain('From the book guide');
  });
});

