import { describe, expect, it } from 'vitest';
import { bootstrapTheme, resolveTheme, THEME_STORAGE_KEY, themeBootstrapScript, type ThemeHost } from './theme';

function host(stored: Record<string, string>, prefersDark: boolean, storageThrows = false) {
  const dataset: Record<string, string> = {};
  const fake: ThemeHost = {
    localStorage: {
      getItem: (key) => {
        if (storageThrows) throw new Error('SecurityError');
        return stored[key] ?? null;
      },
    },
    matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: dark)' && prefersDark }),
    document: { documentElement: { dataset } },
  };
  return { fake, dataset };
}

describe('resolveTheme', () => {
  it.each([
    ['dark', false, 'dark'],
    ['light', true, 'light'],
    [null, true, 'dark'],
    [null, false, 'light'],
    ['sepia', true, 'dark'],
  ] as const)('stored %s with OS dark=%s resolves to %s', (stored, prefersDark, expected) => {
    expect(resolveTheme(stored, prefersDark)).toBe(expected);
  });
});

describe('bootstrapTheme', () => {
  it('applies the stored preference over the OS preference', () => {
    const { fake, dataset } = host({ [THEME_STORAGE_KEY]: 'light' }, true);
    bootstrapTheme(fake);
    expect(dataset.theme).toBe('light');
  });

  it('follows the OS when nothing valid is stored', () => {
    const { fake, dataset } = host({ [THEME_STORAGE_KEY]: 'sepia' }, true);
    bootstrapTheme(fake);
    expect(dataset.theme).toBe('dark');
  });

  it('falls back to the OS when storage is blocked', () => {
    const { fake, dataset } = host({}, true, true);
    bootstrapTheme(fake);
    expect(dataset.theme).toBe('dark');
  });

  it('serializes into a self-contained inline script', () => {
    const { fake, dataset } = host({ [THEME_STORAGE_KEY]: 'dark' }, false);
    new Function('window', themeBootstrapScript)(fake);
    expect(dataset.theme).toBe('dark');
  });
});
