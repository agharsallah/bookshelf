import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeApi } from '../review/testing/fakeApi';
import { AtlasExplorer, openHref } from './AtlasExplorer';
import { ids, shelf } from './fixtures';
import { DEFAULT_LENS } from './lens';

function setup(lens = DEFAULT_LENS) {
  const { api } = fakeApi({ 'GET graph/atlas': () => shelf() });
  render(<AtlasExplorer initial={shelf()} lens={lens} api={api} />);
  return within(screen.getByText('The map as a list').closest('details') as HTMLElement);
}

beforeEach(() => history.replaceState(null, '', '/map'));

describe('<AtlasExplorer>', () => {
  it('shows the whole shelf, and a selected concept leads back to where it is read', async () => {
    const list = setup();
    expect(screen.getByText('8 marks, 9 connections')).toBeTruthy();

    await userEvent.click(list.getByRole('button', { name: /little's law/ }));

    const panel = within(screen.getByRole('complementary', { name: 'Selection' }));
    expect(panel.getByRole('heading', { name: "little's law" })).toBeTruthy();
    expect(panel.getByText('In 2 books, 3 passages')).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Read Queues' }).getAttribute('href')).toBe('/documents/flow/read/ch01');
    expect(panel.getByRole('link', { name: 'Read Stories' }).getAttribute('href')).toBe('/documents/talks/read/ch01');
    expect(panel.getByRole('link', { name: 'Open the concept page' }).getAttribute('href')).toBe('/concepts/law');
    expect(location.search).toContain(`sel=${encodeURIComponent(ids.law)}`);
  });

  it('a chapter names the chapters that share its ideas, across books', async () => {
    const list = setup();
    await userEvent.click(list.getByRole('button', { name: /^Queues/ }));

    const panel = within(screen.getByRole('complementary', { name: 'Selection' }));
    expect(panel.getByRole('link', { name: 'Read this chapter' }).getAttribute('href')).toBe('/documents/flow/read/ch01');
    expect(panel.getByText("via little's law")).toBeTruthy();
    await userEvent.click(panel.getByRole('button', { name: /Stories/ }));
    expect(panel.getByRole('heading', { name: 'Stories' })).toBeTruthy();
  });

  it('the lens narrows to one kind of connection, dimming then hiding the rest', async () => {
    const list = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Lens' }));
    const lens = within(screen.getByRole('complementary', { name: 'Lens' }));

    await userEvent.click(lens.getByRole('button', { name: 'contradicts' }));

    expect(screen.getByText('2 of 8 marks and 1 of 9 connections in view')).toBeTruthy();
    expect(list.getAllByText('(outside the lens)', { exact: false })).toHaveLength(6);
    expect(location.search).toBe('?mode=lens&links=contradicts');

    await userEvent.click(lens.getByRole('radio', { name: 'Hide' }));

    expect(list.getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringMatching(/^wip limit/), expect.stringMatching(/^big batch/)]);
    await userEvent.click(lens.getByRole('button', { name: 'Clear the lens' }));
    expect(screen.getByText('8 marks, 9 connections')).toBeTruthy();
  });

  it('proposed links are another atlas: the toggle fetches it, and bridges can be asked for', async () => {
    const proposed = shelf();
    proposed.edges.push({ ...proposed.edges[6]!, id: 'p1', relation: 'contradicts', status: 'proposed', src: ids.law, dst: ids.batch });
    const { api, calls } = fakeApi({ 'GET graph/atlas': () => proposed, 'POST graph/bridges': () => ({ jobs: ['j1', 'j2'] }) });
    render(<AtlasExplorer initial={shelf()} lens={{ ...DEFAULT_LENS, mode: 'lens' }} api={api} />);
    const lens = within(screen.getByRole('complementary', { name: 'Lens' }));

    await userEvent.click(lens.getByRole('checkbox', { name: 'Proposed links, waiting for you' }));

    await waitFor(() => expect(screen.getByText('8 marks, 10 connections')).toBeTruthy());
    expect(calls.find((c) => c.path === 'graph/atlas')?.query).toEqual({ include_proposed: true });
    expect(location.search).toContain('proposed=1');

    await userEvent.click(lens.getByRole('button', { name: 'Ask how the books relate' }));

    expect(await lens.findByText(/Queued 2 bridge jobs/)).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: 'graph/bridges' });
  });

  it('opens a mark where it lives', () => {
    const [flow, , queues, , , law] = shelf().nodes;
    expect([flow, queues, law].map((n) => (n ? openHref(n) : null))).toEqual(['/documents/flow', '/documents/flow/read/ch01', '/concepts/law']);
  });
});
