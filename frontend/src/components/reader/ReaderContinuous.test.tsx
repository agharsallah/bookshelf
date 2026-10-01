import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { Panes } from './panes';
import { Reader } from './Reader';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), url: (p: string) => `/api/${p}` }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));

function node(anchor: string, kind: TreeNode['kind'], extra: Partial<TreeNode> = {}): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text: null, page_from: 1, page_to: 1, meta: {}, children: [], ...extra };
}

const chapter = (n: number, text: string) =>
  node(`ch0${n}`, 'chapter', { heading: `Chapter ${n}`, children: [node(`ch0${n}/p001`, 'paragraph', { text })] });

const units = [1, 2, 3].map((n) => ({ anchor: `ch0${n}`, heading: `Chapter ${n}` }));
const panes: Panes = { distillation: null, summary: null, sections: [], figures: [] };

/** The end of the text is always in reach; nothing else is ever in view. */
class ReachObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(el: Element) {
    if (el.tagName === 'FOOTER') queueMicrotask(() => this.callback([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
  }
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function renderReader() {
  return render(
    <Reader document={{ id: 'doc-1', slug: 'flow', title: 'Flow' }} unit={chapter(1, 'First words.')} units={units} panes={panes} notes={[]} codeHtml={{}} initialAnchor={null} truncated={false} />,
  );
}

const subtree = (n: number, text: string, truncated = false) => ({ document_id: 'doc-1', slug: 'flow', node: chapter(n, text), truncated });

beforeEach(() => {
  window.localStorage.clear();
  api.get.mockReset();
  api.put.mockReset().mockResolvedValue({});
  vi.stubGlobal('IntersectionObserver', ReachObserver);
});

afterEach(() => vi.unstubAllGlobals());

describe('<Reader> continuous reading', () => {
  it('adds the following chapters below as the end comes into reach, and hides listening', async () => {
    window.localStorage.setItem('bookshelf:reader', JSON.stringify({ continuous: true }));
    api.get.mockImplementation((path: string) =>
      Promise.resolve(path === 'nodes/flow/ch02' ? subtree(2, 'Second words.') : subtree(3, 'Third words.')),
    );
    renderReader();

    expect(await screen.findByText('Third words.')).toBeTruthy();
    expect(screen.getByText('Second words.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chapter 3' })).toBeTruthy();
    expect(api.get.mock.calls.map(([path]) => path)).toEqual(['nodes/flow/ch02', 'nodes/flow/ch03']);
    expect(screen.queryByRole('button', { name: 'Listen' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the document' })).toBeTruthy();
  });

  it('stops after a truncated chapter and links to the next one instead', async () => {
    window.localStorage.setItem('bookshelf:reader', JSON.stringify({ continuous: true }));
    api.get.mockResolvedValue(subtree(2, 'Second words.', true));
    renderReader();

    expect(await screen.findByText('Second words.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Next: Chapter 3' }).getAttribute('href')).toBe('/documents/flow/read/ch03');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  });

  it('reads one chapter at a time when the setting is off', async () => {
    renderReader();

    expect(screen.getByRole('link', { name: 'Next: Chapter 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Listen' })).toBeTruthy();
    await Promise.resolve();
    expect(api.get).not.toHaveBeenCalled();
  });
});
