import { describe, expect, it } from 'vitest';
import { configFromQuery, configToQuery, defaultConfig, isWholeShelf, pillsHref, sameConfig } from './config';

const q = (search: string) => new URLSearchParams(search);

describe('configFromQuery', () => {
  it('is the default feed without presets: the whole shelf, consolidate, 20, no spoilers', () => {
    const config = configFromQuery(q(''));
    expect(config).toEqual(defaultConfig());
    expect(config.length).toBe(20);
    expect(isWholeShelf(config)).toBe(true);
  });

  it('reads every source preset, repeated or comma separated, without duplicates', () => {
    const config = configFromQuery(q('document=a&document=b,a&collection=c1&paper_set=s1&concept=k1,k2&genre=paper'));
    expect(config.sources).toEqual({ documents: ['a', 'b'], collections: ['c1'], paper_sets: ['s1'], concepts: ['k1', 'k2'], genre: 'paper' });
    expect(isWholeShelf(config)).toBe(false);
  });

  it('reads mode, length (endless too), kinds and spoilers', () => {
    const config = configFromQuery(q('mode=preview&length=10&kinds=quiz,flip&spoilers=1'));
    expect(config).toMatchObject({ mode: 'preview', length: 10, kinds: ['quiz', 'flip'], spoilers: true });
    expect(configFromQuery(q('length=endless')).length).toBeNull();
  });

  it('drops what it does not know rather than failing', () => {
    const config = configFromQuery(q('mode=binge&length=7&kinds=meme,quiz&genre=poem'));
    expect(config.mode).toBe('consolidate');
    expect(config.length).toBe(20);
    expect(config.kinds).toEqual(['quiz']);
    expect(config.sources.genre).toBeNull();
  });
});

describe('configToQuery', () => {
  it('writes only what differs from the defaults', () => {
    expect(configToQuery(defaultConfig())).toBe('');
    expect(pillsHref({ length: 10 })).toBe('/pills?length=10');
    expect(pillsHref({ sources: { documents: ['meadows-systems'] } })).toBe('/pills?document=meadows-systems');
  });

  it('round-trips through the URL', () => {
    const config = configFromQuery(q('document=x&collection=y&concept=z&mode=explore&length=endless&kinds=flip,quiz&spoilers=1&genre=book'));
    const back = configFromQuery(q(configToQuery(config).slice(1)));
    expect(back).toEqual({ ...config, kinds: ['quiz', 'flip'] });
    expect(sameConfig(config, back)).toBe(true);
  });

  it('tells different feeds apart', () => {
    expect(sameConfig(defaultConfig(), { ...defaultConfig(), length: 40 })).toBe(false);
  });
});
