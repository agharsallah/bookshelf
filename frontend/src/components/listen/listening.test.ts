import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { CATALOGUE, EPISODE, READING_BODY, READING_ORDER, READING_RENDER, SCRIPT_BODY } from './fixtures';
import {
  audioJobTitle,
  castNames,
  defaultCast,
  downloadName,
  episodeLabel,
  formatTime,
  isAudioJob,
  listeningTime,
  markAt,
  paramsOfVariant,
  parseScript,
  pickRender,
  pickVersion,
  versionLabel,
  versionsOf,
  readingDownloadName,
  readPosition,
  sectionJump,
  speakingAnchor,
  spokenTime,
  startFrom,
  turnAnchor,
  voicesFor,
  writePosition,
} from './listening';

const job = (over: Partial<JobPublic>): JobPublic => ({
  id: 'j1',
  kind: 'derive',
  document_id: 'doc',
  anchor: null,
  skill: 'write-audio-summary',
  skill_version: '1',
  state: 'running',
  attempts: 1,
  error: null,
  result: null,
  run_mode: 'batch',
  duration_ms: null,
  created_at: '2026-09-26T10:00:00Z',
  started_at: null,
  finished_at: null,
  ...over,
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('parseScript', () => {
  it('reads speakers and turns, speakers 0-based', () => {
    const script = parseScript(SCRIPT_BODY);
    expect(script?.speakers.map((s) => s.role)).toEqual(['host', 'co-host']);
    expect(script?.sections[0]?.turns[1]).toEqual({ speaker: 1, text: 'Busy and slow?', cites: ['ch01/p003'] });
  });

  it('drops turns by a speaker the script does not declare, and empty scripts', () => {
    const body = { ...SCRIPT_BODY, sections: [{ title: 'x', turns: [{ speaker: 3, text: 'who?', cites: [] }] }] };
    expect(parseScript(body)).toBeNull();
    expect(parseScript({ title: 'x' })).toBeNull();
  });
});

describe('time', () => {
  it.each([
    [0, '0:00'],
    [65.9, '1:05'],
    [3723, '1:02:03'],
    [Number.NaN, '0:00'],
  ])('formats %s as %s', (seconds, text) => expect(formatTime(seconds)).toBe(text));

  it('says a time in words for screen readers', () => {
    expect(spokenTime(185)).toBe('3 minutes 5 seconds');
    expect(spokenTime(3600)).toBe('1 hour');
    expect(spokenTime(0)).toBe('0 seconds');
  });
});

describe('marks', () => {
  const sections = EPISODE.renders[0]?.sections ?? [];

  it('finds the part playing, -1 before the first starts', () => {
    expect(markAt(sections, 0)).toBe(-1);
    expect(markAt(sections, 10)).toBe(0);
    expect(markAt(sections, 41)).toBe(1);
  });

  it('jumps to the next part, and back to the start of this one after 3 s', () => {
    expect(sectionJump(sections, 10, 1)).toBe(41);
    expect(sectionJump(sections, 50, -1)).toBe(41);
    expect(sectionJump(sections, 42, -1)).toBe(0.4);
    expect(sectionJump(sections, 50, 1)).toBeNull();
  });
});

describe('names', () => {
  it('labels an episode, leaving English implied', () => {
    expect(episodeLabel({ minutes: 5, format: 'panel', language: 'en' })).toBe('5 min · Panel');
    expect(episodeLabel({ minutes: 30, format: 'narrator', language: 'zh' })).toBe('30 min · Narrator · 中文 (Mandarin)');
  });

  it('names a cast', () => {
    expect(castNames(['alice'], CATALOGUE.voices)).toBe('Alice');
    expect(castNames(['alice', 'frank', 'maya'], CATALOGUE.voices)).toBe('Alice, Frank & Maya');
    expect(castNames(['custom-me'], CATALOGUE.voices)).toBe('custom-me');
  });

  it('makes a safe download name', () => {
    expect(downloadName('Queueing: for / Managers?', EPISODE.params)).toBe('Queueing for Managers - 15 min conversation.mp3');
  });

  it('reads an episode key back into params', () => {
    expect(paramsOfVariant('30m-roundtable-zh')).toEqual({ minutes: 30, format: 'roundtable', language: 'zh' });
    expect(paramsOfVariant(null)).toBeNull();
    expect(paramsOfVariant('weird')).toBeNull();
  });
});

describe('where you stopped', () => {
  it('remembers a place, and forgets it at the start or when finished', () => {
    const storage = memoryStorage();
    writePosition(storage, 'k', 125.6);
    expect(readPosition(storage, 'k')).toBe(126);
    writePosition(storage, 'k', 2);
    expect(readPosition(storage, 'k')).toBeNull();
    writePosition(storage, 'k', 90);
    writePosition(storage, 'k', null);
    expect(readPosition(storage, 'k')).toBeNull();
  });

  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } } as unknown as Storage;
    expect(readPosition(broken, 'k')).toBeNull();
    expect(() => writePosition(broken, 'k', 50)).not.toThrow();
  });
});

describe('episodes and jobs', () => {
  it('plays the chosen render, else the newest', () => {
    expect(pickRender(EPISODE, 'r1')?.key).toBe('r1');
    expect(pickRender(EPISODE, 'gone')?.key).toBe('r1');
    expect(pickRender(undefined, null)).toBeNull();
  });

  it('knows which jobs make audio', () => {
    expect(isAudioJob(job({}))).toBe(true);
    expect(isAudioJob(job({ kind: 'narrate', skill: null }))).toBe(true);
    expect(isAudioJob(job({ skill: 'make-quiz' }))).toBe(false);
  });

  it('says what a job is doing', () => {
    const writing = job({ payload: { params: { minutes: 5, format: 'narrator', language: 'en' }, voices: ['maya'] } });
    expect(audioJobTitle(writing, [EPISODE], CATALOGUE.voices)).toBe('Writing the script: 5 min · Narrator, for Maya');
    const recording = job({ kind: 'narrate', skill: null, payload: { artifact_id: 'art-1', voices: ['alice', 'frank'] } });
    expect(audioJobTitle(recording, [EPISODE], CATALOGUE.voices)).toBe('Recording 15 min · Conversation with Alice & Frank');
    const reading = job({ kind: 'narrate', skill: null, anchor: 'ch01', payload: { anchor: 'ch01', voices: ['maya'] } });
    expect(audioJobTitle(reading, [EPISODE], CATALOGUE.voices)).toBe('Reading ch01 aloud with Maya');
  });
});

describe('casting', () => {
  it('puts voices that read the language first', () => {
    expect(voicesFor(CATALOGUE.voices, 'zh')[0]?.id).toBe('xinran');
    expect(voicesFor(CATALOGUE.voices, 'en').at(-1)?.id).toBe('xinran');
  });

  it('casts the default voices of a language, English when it has none', () => {
    expect(defaultCast(CATALOGUE, 'zh', 2)).toEqual(['xinran', 'frank']);
    expect(defaultCast(CATALOGUE, 'fr', 1)).toEqual(['alice']);
  });
});

describe('a chapter read aloud', () => {
  const script = parseScript(READING_BODY)!;
  const turns = READING_RENDER.turns;

  it('knows the passage each turn reads, and which is being read', () => {
    expect(turnAnchor(script, turns[3])).toBe('ch01/s01/p002');
    expect(turnAnchor(script, READING_RENDER.sections[0])).toBeNull();
    expect(speakingAnchor(script, turns, 0)).toBeNull();
    expect(speakingAnchor(script, turns, 5)).toBe('ch01/p001');
    expect(speakingAnchor(script, turns, 9.5)).toBe('ch01/p001');
    expect(speakingAnchor(script, turns, 15)).toBe('ch01/s01/p002');
  });

  it('starts from a passage, or the next one read when that one is not', () => {
    expect(startFrom(script, turns, 'ch01/p001', READING_ORDER)).toBe(3);
    expect(startFrom(script, turns, 'ch01/s01/c001', READING_ORDER)).toBe(12);
    expect(startFrom(script, turns, 'elsewhere', READING_ORDER)).toBeNull();
  });

  it('tells how long it takes and names its download', () => {
    expect(listeningTime(1800)).toBe('About 12 min');
    expect(listeningTime(20)).toBe('About 1 min');
    expect(readingDownloadName('Thinking in Systems', 'Stocks: and / flows?')).toBe('Thinking in Systems - Stocks and flows.mp3');
  });
});

describe('versions', () => {
  const old = { script: { ...EPISODE.script, id: 'art-0', version: 1, review: 'rejected' as const }, renders: EPISODE.renders };
  const current = { script: EPISODE.script, renders: [] };
  const episode = { ...EPISODE, versions: [current, old] };

  it('lists the current version alone when the API sends no history', () => {
    expect(versionsOf(EPISODE)).toEqual([{ script: EPISODE.script, renders: EPISODE.renders }]);
  });

  it('shows the version asked for, else the one the episode plays first', () => {
    expect(pickVersion(episode, 'art-0')?.script.version).toBe(1);
    expect(pickVersion(episode, 'gone')?.script.id).toBe('art-1');
    expect(pickVersion(undefined, null)).toBeUndefined();
  });

  it('says which version is current, which was replaced, and what was recorded', () => {
    expect(versionLabel(current, 'art-1')).toBe('Version 1 · current · not recorded');
    expect(versionLabel(old, 'art-1')).toBe('Version 1 · replaced · 1 recording');
  });
});

