// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EPISODE, SCRIPT_BODY } from './fixtures';
import { parseScript } from './listening';
import { Transcript } from './Transcript';

const script = parseScript(SCRIPT_BODY)!;
const render0 = EPISODE.renders[0]!;

function setup(time: number, withAudio = true) {
  const onSeek = vi.fn();
  render(
    <Transcript
      slug="book"
      script={script}
      speakers={['Host · Alice', 'Co-host · Frank']}
      sections={withAudio ? render0.sections : null}
      turns={withAudio ? render0.turns : null}
      time={time}
      onSeek={onSeek}
    />,
  );
  return onSeek;
}

describe('Transcript', () => {
  it('marks the turn being spoken', () => {
    setup(30);
    const current = document.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain('Busy and slow?');
    expect(current?.textContent).toContain('Co-host · Frank');
  });

  it('plays from a part or a turn when you click its time', async () => {
    const onSeek = setup(0);
    await userEvent.click(screen.getByRole('button', { name: /Start less/ }));
    expect(onSeek).toHaveBeenLastCalledWith(41);
    await userEvent.click(screen.getByRole('button', { name: 'Play from 0:25' }));
    expect(onSeek).toHaveBeenLastCalledWith(25);
  });

  it('links each line to the passage it comes from', () => {
    setup(0);
    const links = screen.getAllByRole('link', { name: /source ch01\/p003/ });
    expect(links[0]?.getAttribute('href')).toBe('/documents/book/read/ch01/p003');
  });

  it('reads as a plain script before there is audio', () => {
    setup(0, false);
    expect(screen.queryByRole('button', { name: /Play from/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'The busiest team' })).toBeTruthy();
  });
});
