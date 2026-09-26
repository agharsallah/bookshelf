/**
 * The Listen page's pure logic: reading an `audio_summary` script, naming episodes and
 * speakers, time on the player's clock, which section or turn is playing, and the place
 * you stopped at (kept per render in localStorage, when the browser allows it).
 */
import type { Anchor } from '../../lib/contract';
import type { AudioEpisode, AudioRender, Mark, VoicePublic } from '../../lib/api/types/audio';
import type { JobPublic } from '../../lib/api/types/jobs';

export const AUDIO_SKILL = 'write-audio-summary';
export const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2] as const;
/** How far the skip buttons and arrow keys jump, in seconds. */
export const SKIP_BACK = 15;
export const SKIP_AHEAD = 30;

export interface ScriptTurn {
  /** 0-based index into `speakers`. */
  speaker: number;
  text: string;
  cites: Anchor[];
}

export interface ScriptSection {
  title: string;
  turns: ScriptTurn[];
}

export interface Script {
  title: string;
  speakers: { role: string; persona: string }[];
  sections: ScriptSection[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The script in an artifact body, or null when it has no speakers or nothing to say. */
export function parseScript(body: unknown): Script | null {
  if (!isRecord(body) || !Array.isArray(body.speakers) || !Array.isArray(body.sections)) return null;
  const speakers = body.speakers.filter(isRecord).map((s) => ({ role: text(s.role), persona: text(s.persona) }));
  const sections = body.sections.filter(isRecord).map((section) => ({
    title: text(section.title),
    turns: (Array.isArray(section.turns) ? section.turns : []).filter(isRecord).flatMap((turn) => {
      const speaker = Number(turn.speaker) - 1;
      const words = text(turn.text);
      if (!Number.isInteger(speaker) || speaker < 0 || speaker >= speakers.length || !words) return [];
      const cites = Array.isArray(turn.cites) ? turn.cites.filter((c): c is Anchor => typeof c === 'string') : [];
      return [{ speaker, text: words, cites }];
    }),
  }));
  if (speakers.length === 0 || sections.every((s) => s.turns.length === 0)) return null;
  return { title: text(body.title), speakers, sections };
}

export const MINUTES_LABELS: Readonly<Record<string, { label: string; hint: string }>> = {
  '5': { label: '5 min', hint: 'The gist: the thesis and what carries it' },
  '15': { label: '15 min', hint: 'Every big idea, with an example each' },
  '30': { label: '30 min', hint: 'In depth: frameworks, evidence, objections' },
};

export const FORMAT_LABELS: Readonly<Record<string, { label: string; hint: string; roles: string[] }>> = {
  narrator: { label: 'Narrator', hint: 'One storyteller, talking to you', roles: ['Narrator'] },
  conversation: { label: 'Conversation', hint: 'Two hosts: one explains, one asks', roles: ['Host', 'Co-host'] },
  panel: { label: 'Panel', hint: 'A host, a champion and a practitioner', roles: ['Host', 'Champion', 'Practitioner'] },
  roundtable: { label: 'Roundtable', hint: 'Four voices, a skeptic among them', roles: ['Host', 'Champion', 'Practitioner', 'Skeptic'] },
};

export const LANGUAGE_LABELS: Readonly<Record<string, string>> = { en: 'English', zh: '中文 (Mandarin)' };

/** An episode key back to its params: `15m-conversation-en` → `{minutes: 15, format:
 * 'conversation', language: 'en'}` (skills/write-audio-summary `variant`), else null. */
export function paramsOfVariant(variant: string | null | undefined): Record<string, string | number> | null {
  const match = /^(\d+)m-([a-z]+)-([a-z]+)$/.exec(variant ?? '');
  return match ? { minutes: Number(match[1]), format: match[2] ?? '', language: match[3] ?? '' } : null;
}

/** "15 min · Conversation · English" */
export function episodeLabel(params: Readonly<Record<string, string | number>>): string {
  const minutes = MINUTES_LABELS[String(params.minutes)]?.label ?? `${String(params.minutes ?? '?')} min`;
  const format = FORMAT_LABELS[String(params.format)]?.label ?? String(params.format ?? '');
  const language = String(params.language ?? 'en');
  return [minutes, format, language === 'en' ? null : (LANGUAGE_LABELS[language] ?? language)].filter(Boolean).join(' · ');
}

/** The voices of a cast by name, speaker 1 first: "Alice & Frank", "Alice, Frank & Maya". */
export function castNames(ids: readonly string[], voices: readonly VoicePublic[]): string {
  const names = ids.map((id) => voices.find((v) => v.id === id)?.name ?? id);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names.at(-1) ?? ''}`;
}

/** `65` → "1:05", `3723` → "1:02:03". */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "3 minutes 5 seconds", for screen readers. */
export function spokenTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const parts: [number, string][] = [
    [Math.floor(total / 3600), 'hour'],
    [Math.floor((total % 3600) / 60), 'minute'],
    [total % 60, 'second'],
  ];
  const said = parts.filter(([n]) => n > 0).map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`);
  return said.length > 0 ? said.join(' ') : '0 seconds';
}

/** The mark playing at `time`: the last one that has started, or -1 before the first. */
export function markAt(marks: readonly Mark[], time: number): number {
  let found = -1;
  for (let i = 0; i < marks.length; i++) {
    if ((marks[i]?.start ?? Infinity) <= time + 0.05) found = i;
    else break;
  }
  return found;
}

/** Where the next / previous section button goes. Previous restarts the current section
 * when you are more than 3 s into it, as music players do. */
export function sectionJump(marks: readonly Mark[], time: number, direction: 1 | -1): number | null {
  const current = markAt(marks, time);
  if (direction === 1) return marks[current + 1]?.start ?? null;
  const here = marks[current];
  if (here && time - here.start > 3) return here.start;
  return marks[Math.max(current - 1, 0)]?.start ?? 0;
}

/** "Thinking in Systems - 15 min conversation.mp3" */
export function downloadName(bookTitle: string, params: Readonly<Record<string, string | number>>): string {
  const label = episodeLabel(params).replaceAll(' · ', ' ').toLowerCase();
  const safe = `${bookTitle} - ${label}`.replace(/[^\p{L}\p{N}._ -]+/gu, '').replace(/\s+/g, ' ').trim();
  return `${safe.slice(0, 140)}.mp3`;
}

/** The API path of a render or sample (`audio/files/…`) as the browser fetches it. */
export function apiPath(path: string, query?: Record<string, string>): string {
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  return `/api/${path.replace(/^\/+/, '')}${search}`;
}

// --- Where you stopped ---------------------------------------------------------------

const POSITION_PREFIX = 'bookshelf:listen:';

export function positionKey(render: Pick<AudioRender, 'key'>): string {
  return `${POSITION_PREFIX}${render.key}`;
}

export function readPosition(storage: Storage | undefined, key: string): number | null {
  try {
    const raw = storage?.getItem(key);
    const value = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Remember `time`, or forget it (`null`: finished, or back at the start). */
export function writePosition(storage: Storage | undefined, key: string, time: number | null): void {
  try {
    if (time === null || time < 5) storage?.removeItem(key);
    else storage?.setItem(key, String(Math.round(time)));
  } catch {
    // Storage full or blocked: the place is simply not remembered.
  }
}

export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// --- Episodes and the jobs making them ------------------------------------------------

/** The render to play: `key` if the episode has it, else its newest. */
export function pickRender(episode: AudioEpisode | undefined, key: string | null): AudioRender | null {
  if (!episode) return null;
  return episode.renders.find((r) => r.key === key) ?? episode.renders[0] ?? null;
}

/** Whether a job is part of making audio: writing a script, or recording one. */
export function isAudioJob(job: Pick<JobPublic, 'kind' | 'skill'>): boolean {
  return job.kind === 'narrate' || (job.kind === 'derive' && job.skill === AUDIO_SKILL);
}

/** What a live audio job is doing, in words: "Writing the script: 15 min · Conversation". */
export function audioJobTitle(job: JobPublic, episodes: readonly AudioEpisode[], voices: readonly VoicePublic[]): string {
  const payload = job.payload ?? {};
  const cast = Array.isArray(payload.voices) ? castNames(payload.voices.map(String), voices) : '';
  if (job.kind === 'derive') {
    const params = isRecord(payload.params) ? (payload.params as Record<string, string | number>) : {};
    return `Writing the script: ${episodeLabel(params)}${cast ? `, for ${cast}` : ''}`;
  }
  const episode = episodes.find((e) => e.script.id === payload.artifact_id);
  return `Recording${episode ? ` ${episodeLabel(episode.params)}` : ''}${cast ? ` with ${cast}` : ''}`;
}
