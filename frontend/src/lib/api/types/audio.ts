/** Audio summary wire shapes (backend/app/schemas/audio.py). */
import type { Origin, Review } from './artifacts';

/** A voice to cast (`GET /audio/voices`). `sample_url` is relative to the API prefix. */
export interface VoicePublic {
  id: string;
  name: string;
  gender: string;
  accent: string;
  languages: string[];
  /** Narrates over the reference clip's music bed. */
  with_music: boolean;
  /** Your own recording. */
  custom: boolean;
  sample_url: string;
}

export interface VoiceCatalogue {
  voices: VoicePublic[];
  /** Speakers per episode format (`narrator: 1`, `conversation: 2`, …). */
  speakers: Record<string, number>;
  /** Per language, the default cast in order. */
  defaults: Record<string, string[]>;
}

/** Where a section (or, with `turn`, one turn of it) starts and ends, in seconds. */
export interface Mark {
  start: number;
  end: number;
  section: number;
  turn: number | null;
  title: string | null;
}

/** One voicing of a script. `url` is relative to the API prefix. */
export interface AudioRender {
  key: string;
  voices: string[];
  duration: number;
  sections: Mark[];
  /** Estimated: each turn's share of its section. */
  turns: Mark[];
  url: string;
  engine: Record<string, unknown>;
  created_at: string;
}

export interface AudioScript {
  id: string;
  version: number;
  origin: Origin;
  review: Review;
  /** `{title, speakers, sections}` (skills/write-audio-summary/schema.json). */
  body: Record<string, unknown>;
  gates: Record<string, unknown>;
  created_at: string;
}

export interface AudioEpisode {
  variant: string;
  params: Record<string, string | number>;
  script: AudioScript;
  /** Newest first. */
  renders: AudioRender[];
}

/** `GET /documents/{ref}/audio`: shortest episode first. */
export interface AudioShelf {
  document_id: string;
  episodes: AudioEpisode[];
}
