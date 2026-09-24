import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, isDefaultType, parsePrefs, prefsVars, SIZES } from './prefs';

describe('parsePrefs', () => {
  it('starts from the defaults when nothing is stored or it is not JSON', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('[1,2]')).toEqual(DEFAULT_PREFS);
  });

  it('keeps valid fields and replaces invalid ones field by field', () => {
    const prefs = parsePrefs(JSON.stringify({ font: 'sans', leading: 'enormous', pane: false, focus: 'yes', width: 'wide' }));
    expect(prefs).toEqual({ ...DEFAULT_PREFS, font: 'sans', pane: false, width: 'wide' });
  });

  it('clamps the size into the scale and rounds it to a step', () => {
    expect(parsePrefs('{"size": 99}').size).toBe(SIZES.length - 1);
    expect(parsePrefs('{"size": -3}').size).toBe(0);
    expect(parsePrefs('{"size": 2.6}').size).toBe(3);
    expect(parsePrefs('{"size": null}').size).toBe(DEFAULT_PREFS.size);
  });
});

describe('prefsVars', () => {
  it('turns the typography into custom properties', () => {
    const vars = prefsVars({ ...DEFAULT_PREFS, font: 'sans', size: 0, leading: 'airy', spacing: 'roomy', width: 'narrow', align: 'justify' });
    expect(vars).toEqual({
      '--reader-font': 'var(--font-ui)',
      '--reader-size': `${SIZES[0]}rem`,
      '--reader-leading': '2',
      '--reader-gap': '1.5em',
      '--reader-measure': '34rem',
      '--reader-align': 'justify',
    });
  });
});

describe('isDefaultType', () => {
  it('ignores the panes and reading aids', () => {
    expect(isDefaultType({ ...DEFAULT_PREFS, pane: false, focus: true, semantic: true })).toBe(true);
    expect(isDefaultType({ ...DEFAULT_PREFS, size: 5 })).toBe(false);
  });
});
