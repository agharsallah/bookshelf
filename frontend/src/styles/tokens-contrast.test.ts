/**
 * Every text colour of the palette must stay readable on every surface it is set on,
 * in both themes, at WCAG AA for body text (4.5:1); ink on the highlighter too.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const PAIR = /(--[\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi;
const palette = new Map([...source.matchAll(PAIR)].map((m) => [m[1] ?? '', [m[2] ?? '', m[3] ?? ''] as const]));

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

const TEXT = ['--ink', '--ink-2', '--ink-3', '--accent', '--tone-important', '--tone-caution', '--tone-insight', '--tone-remember'];
const SURFACES = ['--paper', '--paper-raised', '--paper-sunken'];
const cases = TEXT.flatMap((text) => SURFACES.flatMap((surface) => ([0, 1] as const).map((theme) => [text, surface, theme] as const)));

describe('palette contrast', () => {
  it.each(cases)('%s on %s (theme %i) reaches 4.5:1', (text, surface, theme) => {
    const fg = palette.get(text)?.[theme];
    const bg = palette.get(surface)?.[theme];
    expect(fg && bg).toBeTruthy();
    expect(contrast(fg ?? '#000000', bg ?? '#000000')).toBeGreaterThanOrEqual(4.5);
  });

  it.each([0, 1] as const)('ink on the highlighter and on accent buttons reads in theme %i', (theme) => {
    const marker = palette.get('--marker')?.[theme] ?? '#000000';
    expect(contrast('#1e2227', marker)).toBeGreaterThanOrEqual(7);
    const accent = palette.get('--accent')?.[theme] ?? '#000000';
    const onAccent = palette.get('--on-accent')?.[theme] ?? '#000000';
    expect(contrast(onAccent, accent)).toBeGreaterThanOrEqual(4.5);
  });
});
