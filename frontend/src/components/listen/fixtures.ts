/** Test fixtures for listening: one two-host episode with one recording, and a chapter read aloud. */
import type { AudioEpisode, AudioRender, ChapterAudio, VoiceCatalogue } from '../../lib/api/types/audio';
import type { SkillParam } from '../../lib/api/types/skills';

export const SCRIPT_BODY = {
  title: 'Why busy teams are slow',
  speakers: [
    { role: 'host', persona: 'Has read it twice.' },
    { role: 'co-host', persona: 'Has not read it.' },
  ],
  sections: [
    {
      title: 'The busiest team',
      turns: [
        { speaker: 1, text: 'The busiest team ships the least.', cites: ['ch01/p003'] },
        { speaker: 2, text: 'Busy and slow?', cites: ['ch01/p003'] },
      ],
    },
    {
      title: 'Start less',
      turns: [{ speaker: 1, text: 'Cap the work in progress.', cites: ['ch05/p001'] }],
    },
  ],
};

export const EPISODE: AudioEpisode = {
  variant: '15m-conversation-en',
  params: { minutes: 15, format: 'conversation', language: 'en' },
  script: { id: 'art-1', version: 1, origin: 'skill', review: 'draft', body: SCRIPT_BODY, gates: {}, created_at: '2026-09-26T10:00:00Z' },
  renders: [
    {
      key: 'r1',
      voices: ['alice', 'frank'],
      duration: 100,
      sections: [
        { start: 0.4, end: 40, section: 0, turn: null, title: 'The busiest team' },
        { start: 41, end: 98, section: 1, turn: null, title: 'Start less' },
      ],
      turns: [
        { start: 0.4, end: 25, section: 0, turn: 0, title: null },
        { start: 25, end: 40, section: 0, turn: 1, title: null },
        { start: 41, end: 98, section: 1, turn: 0, title: null },
      ],
      url: 'audio/files/doc/art-1/r1.mp3',
      engine: {},
      created_at: '2026-09-26T10:30:00Z',
    },
  ],
};

export const CATALOGUE: VoiceCatalogue = {
  voices: [
    { id: 'alice', name: 'Alice', gender: 'woman', accent: 'American English', languages: ['en'], with_music: false, custom: false, sample_url: 'audio/voices/alice/sample' },
    { id: 'frank', name: 'Frank', gender: 'man', accent: 'American English', languages: ['en'], with_music: false, custom: false, sample_url: 'audio/voices/frank/sample' },
    { id: 'maya', name: 'Maya', gender: 'woman', accent: 'American English', languages: ['en'], with_music: false, custom: false, sample_url: 'audio/voices/maya/sample' },
    { id: 'carter', name: 'Carter', gender: 'man', accent: 'American English', languages: ['en'], with_music: false, custom: false, sample_url: 'audio/voices/carter/sample' },
    { id: 'xinran', name: 'Xinran', gender: 'woman', accent: 'Mandarin', languages: ['zh', 'en'], with_music: false, custom: false, sample_url: 'audio/voices/xinran/sample' },
  ],
  speakers: { narrator: 1, conversation: 2, panel: 3, roundtable: 4 },
  defaults: { en: ['alice', 'frank', 'maya', 'carter'], zh: ['xinran', 'frank', 'maya', 'alice'] },
};

export const PARAMS: Record<string, SkillParam> = {
  minutes: { choices: [5, 15, 30], default: 15, description: '' },
  format: { choices: ['narrator', 'conversation', 'panel', 'roundtable'], default: 'conversation', description: '' },
  language: { choices: ['en', 'zh'], default: 'en', description: '' },
};

/** `ch01` read aloud: its heading, a paragraph, then a section (heading and paragraph). */
export const READING_BODY = {
  title: 'Stocks and flows',
  speakers: [{ role: 'reader', persona: 'reads the text as it is written' }],
  sections: [
    {
      title: 'Stocks and flows',
      turns: [
        { speaker: 1, text: 'Stocks and flows.', cites: ['ch01'] },
        { speaker: 1, text: 'A stock is memory.', cites: ['ch01/p001'] },
      ],
    },
    {
      title: 'Flows',
      turns: [
        { speaker: 1, text: 'Flows.', cites: ['ch01/s01'] },
        { speaker: 1, text: 'Flows change stocks.', cites: ['ch01/s01/p002'] },
      ],
    },
  ],
};

/** Blocks of `ch01` in reading order; `ch01/s01/c001` is code, which is not read. */
export const READING_ORDER: ReadonlyMap<string, number> = new Map(
  ['ch01', 'ch01/p001', 'ch01/s01', 'ch01/s01/c001', 'ch01/s01/p002'].map((anchor, i) => [anchor, i]),
);

export const READING_RENDER: AudioRender = {
  key: 'read-1',
  voices: ['maya'],
  duration: 20,
  sections: [
    { start: 0.4, end: 9, section: 0, turn: null, title: 'Stocks and flows' },
    { start: 10, end: 19, section: 1, turn: null, title: 'Flows' },
  ],
  turns: [
    { start: 0.4, end: 3, section: 0, turn: 0, title: null },
    { start: 3, end: 9, section: 0, turn: 1, title: null },
    { start: 10, end: 12, section: 1, turn: 0, title: null },
    { start: 12, end: 19, section: 1, turn: 1, title: null },
  ],
  url: 'audio/files/doc/read~ch01/read-1.mp3',
  engine: {},
  created_at: '2026-09-27T10:00:00Z',
};

export const CHAPTER_AUDIO: ChapterAudio = { anchor: 'ch01', title: 'Stocks and flows', script: READING_BODY, words: 450, renders: [READING_RENDER] };
