import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../review/testing/fakeApi';
import { CommandPalette } from './CommandPalette';

const doc = { id: 'm', slug: 'meadows', title: 'Thinking in Systems', authors: ['Donella Meadows'] };

function setup() {
  const visited: string[] = [];
  const { api } = fakeApi({
    'GET search/suggest': () => ({
      items: [
        { kind: 'chapter', label: 'Stocks and flows', document: doc, anchor: 'ch01' },
        { kind: 'concept', label: 'stock', id: 'c1' },
      ],
    }),
  });
  render(<CommandPalette api={api} navigate={(href) => visited.push(href)} debounceMs={0} />);
  return visited;
}

describe('CommandPalette', () => {
  it('opens on ctrl-K, lists matches as you type, and opens the active one on Enter', async () => {
    const visited = setup();
    await userEvent.keyboard('{Control>}k{/Control}');
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'stock');
    expect(await screen.findByRole('option', { name: /Stocks and flows/ })).toBeTruthy();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(visited).toEqual(['/concepts/c1']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape without going anywhere', async () => {
    const visited = setup();
    await userEvent.click(screen.getByRole('button', { name: /Jump to/ }));
    await userEvent.keyboard('{Escape}');
    expect([screen.queryByRole('dialog'), visited]).toEqual([null, []]);
  });
});
