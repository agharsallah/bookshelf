/**
 * Highlighted code must stay readable: every Shiki token colour (tokens.css) against
 * the sunken leaf code sits on (tokens.css), in both themes, at WCAG AA for body text.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const PAIR = /(--[\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi;

function pairs(source: string): Map<string, [string, string]> {
  return new Map([...source.matchAll(PAIR)].map((m) => [m[1] ?? '', [m[2] ?? '', m[3] ?? '']]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const all = pairs(css('../../styles/tokens.css'));
const sunken = all.get('--paper-sunken');
const tokens = [...all].filter(([name]) => name.startsWith('--shiki-token-'));

describe('Shiki token colours', () => {
  it('are all defined as light/dark pairs next to a sunken background', () => {
    expect([sunken !== undefined, tokens.length > 5]).toEqual([true, true]);
  });

  it.each(tokens.flatMap(([name, [light, dark]]) => [[name, 'light', light, 0], [name, 'dark', dark, 1]] as const))(
    '%s in %s (%s) reaches 4.5:1 on the code background',
    (_name, _theme, colour, index) => {
      expect(contrast(colour, sunken?.[index] ?? '#000000')).toBeGreaterThanOrEqual(4.5);
    },
  );
});
