/**
 * Choosing a voice: a select of the catalogue's voices with a button to hear the chosen
 * one first (its reference clip). `useVoicePreview` plays one sample at a time, for every
 * voice row on the page; it stops when the page leaves it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePublic } from '../../lib/api/types/audio';
import { apiPath } from './listening';
import styles from './Listen.module.css';

export interface VoicePreview {
  /** The voice whose sample is playing, if any. */
  previewing: string | null;
  /** Play `voice`'s sample, or stop it when it is the one playing. */
  hear: (voice: VoicePublic) => void;
}

export function useVoicePreview(): VoicePreview {
  const sample = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => () => sample.current?.pause(), []);

  const hear = useCallback(
    (voice: VoicePublic) => {
      sample.current?.pause();
      if (previewing === voice.id) {
        setPreviewing(null);
        return;
      }
      const audio = new Audio(apiPath(voice.sample_url));
      audio.addEventListener('ended', () => setPreviewing(null));
      sample.current = audio;
      setPreviewing(voice.id);
      void audio.play().catch(() => setPreviewing(null));
    },
    [previewing],
  );

  return { previewing, hear };
}

export interface VoiceSelectProps {
  /** What this voice does ("Host", "Reader"). */
  role: string;
  voices: readonly VoicePublic[];
  value: string;
  onChange: (id: string) => void;
  preview: VoicePreview;
  /** Speaker index, for styling rows by speaker. */
  speaker?: number;
}

export function VoiceSelect({ role, voices, value, onChange, preview, speaker = 0 }: VoiceSelectProps) {
  const chosen = voices.find((v) => v.id === value);
  const playing = chosen !== undefined && preview.previewing === chosen.id;
  return (
    <div className={styles.castRow} data-speaker={speaker}>
      <label>
        <span className={styles.role}>{role}</span>
        <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name} — {voice.accent}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => preview.hear(chosen)}
          aria-pressed={playing}
          aria-label={playing ? `Stop ${chosen.name}` : `Hear ${chosen.name}`}
        >
          {playing ? 'Stop' : 'Hear'}
        </button>
      )}
    </div>
  );
}
