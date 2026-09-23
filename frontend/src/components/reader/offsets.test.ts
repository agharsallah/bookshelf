// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { pointOffset, selectionRange } from './offsets';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  // "- stocks and\n- flows" rendered as a list: markers sit outside the runs.
  root = document.createElement('div');
  root.innerHTML =
    '<ul><li><span aria-hidden="true">•</span><span data-o="2">stocks </span><mark><span data-o="9">and</span></mark></li>' +
    '<li><span aria-hidden="true">•</span><span data-o="15">flows</span></li></ul>';
  document.body.append(root);
});

const run = (offset: string) => root.querySelector(`[data-o="${offset}"]`)!.firstChild!;

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('pointOffset', () => {
  it('adds the offset inside a run to the run’s start', () => {
    expect(pointOffset(root, run('2'), 3)).toBe(5);
    expect(pointOffset(root, run('9'), 1)).toBe(10);
  });

  it('snaps a point in a list marker to the start of the next run', () => {
    const marker = root.querySelectorAll('li')[1]!.firstChild!.firstChild!;
    expect(pointOffset(root, marker, 0)).toBe(15);
  });

  it('maps an element boundary after the last run to the end of the text', () => {
    expect(pointOffset(root, root, root.childNodes.length)).toBe(20);
  });
});

describe('selectionRange', () => {
  it('maps a selection across runs and a highlight to text offsets', () => {
    const selection = select(run('2'), 0, run('15'), 3);
    expect(selectionRange(root, selection)).toEqual({ start: 2, end: 18 });
  });

  it('orders a backwards selection', () => {
    const selection = select(run('2'), 0, run('9'), 3);
    // Collapse-and-extend is how a backwards drag looks to the Selection API.
    selection.collapse(run('9'), 3);
    selection.extend(run('2'), 1);
    expect(selectionRange(root, selection)).toEqual({ start: 3, end: 12 });
  });

  it('is null for a collapsed selection or one leaving the block', () => {
    expect(selectionRange(root, select(run('2'), 2, run('2'), 2))).toBeNull();
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.append(outside);
    expect(selectionRange(root, select(run('2'), 0, outside.firstChild!, 4))).toBeNull();
  });
});
