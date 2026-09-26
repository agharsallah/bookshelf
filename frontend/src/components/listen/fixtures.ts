/** Test fixtures for the Listen page: one two-host episode with one recording. */
import type { AudioEpisode, VoiceCatalogue } from '../../lib/api/types/audio';
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
