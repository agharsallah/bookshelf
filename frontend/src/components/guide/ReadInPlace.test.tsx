import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import { clearChapterCache } from './passage';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));

const { ReadInPlace, ReadLink } = await import('./ReadInPlace');

const leaf = (anchor: string, text: string): TreeNode =>
  ({ id: anchor, anchor, kind: 'paragraph', ordinal: 0, depth: 1, heading: null, text, page_from: 1, page_to: 1, meta: {}, children: [] }) as TreeNode;
const chapter = (anchor: string, heading: string, children: TreeNode[] = []): TreeNode => ({ ...leaf(anchor, ''), kind: 'chapter', heading, text: null, children });

const ch02 = chapter('ch02', 'Queues', [leaf('ch02/p001', 'Work waits in queues.'), leaf('ch02/p004', "Little's law ties them together.")]);
const outline = { document_id: 'd', slug: 'flow', depth: 4, include_blocks: false, nodes: [chapter('ch01', 'Flow'), chapter('ch02', 'Queues'), chapter('ch03', 'Limits')] };

function route(path: string) {
  if (path === 'documents/flow/tree') return Promise.resolve(outline);
  if (path === 'nodes/flow/ch02') return Promise.resolve({ node: ch02, truncated: false });
  return Promise.reject(new Error(`unexpected ${path}`));
}

const assign = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
});

beforeEach(() => {
  clearChapterCache();
  api.get.mockReset().mockImplementation(route);
  assign.mockReset();
  window.localStorage.clear();
});

describe('<ReadLink>', () => {
  it('opens the chapter in place at the passage, marked', async () => {
    render(
      <ReadInPlace>
        <ReadLink slug="flow" anchor="ch02/p004">
          Read
        </ReadLink>
      </ReadInPlace>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Read' }));

    const dialog = await screen.findByRole('dialog', { name: 'Queues' });
    await waitFor(() => expect(dialog.querySelector('[data-cited]')?.getAttribute('data-source-anchor')).toBe('ch02/p004'));
    expect(within(dialog).getByText('Work waits in queues.')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Open in reader' }).getAttribute('href')).toBe('/documents/flow/read/ch02/p004');
    expect(assign).not.toHaveBeenCalled();
  });

  it('leaves a ⌘-click to the browser', () => {
    render(
      <ReadInPlace>
        <ReadLink slug="flow" anchor="ch02">
          Read
        </ReadLink>
      </ReadInPlace>,
    );
    const link = screen.getByRole('link', { name: 'Read' });
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('is a plain link into the reader outside a ReadInPlace', () => {
    render(
      <ReadLink slug="flow" anchor="ch02/p004">
        Read
      </ReadLink>,
    );
    const link = screen.getByRole('link', { name: 'Read' });
    expect(link.getAttribute('href')).toBe('/documents/flow/read/ch02/p004');
    expect(fireEvent.click(link)).toBe(true);
  });

  it('goes to the reader when the passage lies outside every chapter', async () => {
    render(
      <ReadInPlace>
        <ReadLink slug="flow" anchor="appendix/p001">
          Read
        </ReadLink>
      </ReadInPlace>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Read' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/documents/flow/read/appendix/p001'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
