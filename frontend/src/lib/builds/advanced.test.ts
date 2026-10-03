import { describe, expect, it } from 'vitest';
import { ADVANCED_DEFAULTS } from '../api/types/builds';
import { advancedBaseline, changedCount, validateAdvanced, validateExtraCommand, validateTopic } from './advanced';

describe('advanced options', () => {
  it('start from your settings over the built-in defaults, even when the settings have none', () => {
    expect(advancedBaseline(undefined)).toEqual(ADVANCED_DEFAULTS);
    expect(advancedBaseline({ model: 'opus' })).toEqual({ ...ADVANCED_DEFAULTS, model: 'opus' });
  });

  it('count each value that differs from where the build started, web access included', () => {
    const baseline = advancedBaseline({ model: 'opus' });
    expect(changedCount(baseline, false, baseline)).toBe(0);
    expect(changedCount({ ...baseline, model: 'auto', extra_commands: ['make'], toolchains: [] }, true, baseline)).toBe(4);
  });

  it('take extra commands and topics in the shapes the backend accepts', () => {
    expect(validateExtraCommand('make')).toBeNull();
    expect(validateExtraCommand('cargo build')).toBeNull();
    expect(validateExtraCommand('Make')).toMatch(/lowercase/);
    expect(validateExtraCommand('rm;ls')).toMatch(/lowercase/);
    expect(validateTopic('machine-learning')).toBeNull();
    expect(validateTopic('-x')).toMatch(/topic/);
    expect(validateAdvanced({ ...ADVANCED_DEFAULTS, extra_commands: Array.from({ length: 11 }, (_, i) => `c${i}`) })).toEqual({ extraCommands: 'At most 10 commands.' });
  });
});
