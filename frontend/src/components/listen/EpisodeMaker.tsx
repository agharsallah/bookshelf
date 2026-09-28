/**
 * Make an episode: choose how long (5, 15 or 30 minutes), who talks (a narrator, two
 * hosts, a panel of three or a roundtable of four), the language, and a voice for each
 * speaker — you can hear each voice before choosing it. Queues one `derive` job
 * (write-audio-summary with these `params` and `voices`); the recording follows by itself.
 * Asking again for an episode that exists with a new cast re-records the same script.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { VoiceCatalogue } from '../../lib/api/types/audio';
import type { JobPublic } from '../../lib/api/types/jobs';
import type { SkillParam } from '../../lib/api/types/skills';
import { enqueueJob } from '../../lib/jobs/api';
import { problemOf } from '../common/Problem';
import { readVoice } from '../../lib/voice';
import { AUDIO_SKILL, defaultCast, FORMAT_LABELS, LANGUAGE_LABELS, MINUTES_LABELS, voicesFor } from './listening';
import { useVoicePreview, VoiceSelect } from './VoiceSelect';
import styles from './Listen.module.css';

export interface EpisodeMakerProps {
  documentId: string;
  catalogue: VoiceCatalogue;
  /** The skill's declared params (`GET /skills`); their choices and defaults. */
  params: Record<string, SkillParam>;
  /** Episodes that already exist (`variant`s), to say "record again" rather than "make". */
  existing: readonly string[];
  onQueued: (job: JobPublic) => void;
  api?: Pick<ApiClient, 'post' | 'delete'>;
}

const choicesOf = (param: SkillParam | undefined, fallback: string[]): string[] => (param ? param.choices.map(String) : fallback);

export function EpisodeMaker({ documentId, catalogue, params, existing, onQueued, api = browserApi }: EpisodeMakerProps) {
  const minutesChoices = choicesOf(params.minutes, ['5', '15', '30']);
  const formatChoices = choicesOf(params.format, Object.keys(FORMAT_LABELS));
  const languageChoices = choicesOf(params.language, ['en']);
  const [minutes, setMinutes] = useState(String(params.minutes?.default ?? '15'));
  const [format, setFormat] = useState(String(params.format?.default ?? 'conversation'));
  const [language, setLanguage] = useState(String(params.language?.default ?? 'en'));
  const count = catalogue.speakers[format] ?? 2;
  const [cast, setCast] = useState<string[]>(() => defaultCast(catalogue, language, 4, readVoice()));
  const [fresh, setFresh] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useVoicePreview();
  const variant = `${minutes}m-${format}-${language}`;
  const exists = existing.includes(variant);
  const roles = FORMAT_LABELS[format]?.roles ?? [];
  const options = useMemo(() => voicesFor(catalogue.voices, language), [catalogue.voices, language]);

  const pickLanguage = (next: string) => {
    setLanguage(next);
    setCast(defaultCast(catalogue, next, 4, readVoice()));
  };
  const pickVoice = (speaker: number, id: string) => setCast((current) => current.map((v, i) => (i === speaker ? id : v)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      const accepted = await enqueueJob(api, {
        kind: 'derive',
        document_id: documentId,
        skill: AUDIO_SKILL,
        params: { minutes: Number(minutes), format, language },
        voices: cast.slice(0, count),
        force: fresh,
      });
      onQueued(accepted.job);
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={styles.maker} onSubmit={(event) => void submit(event)}>
      <fieldset className={styles.choice}>
        <legend>How long</legend>
        {minutesChoices.map((m) => (
          <label key={m} className={styles.option}>
            <input type="radio" name="minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} />
            <span className={styles.optionLabel}>{MINUTES_LABELS[m]?.label ?? `${m} min`}</span>
            <span className={styles.optionHint}>{MINUTES_LABELS[m]?.hint}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className={styles.choice}>
        <legend>Who talks</legend>
        {formatChoices.map((f) => (
          <label key={f} className={styles.option}>
            <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} />
            <span className={styles.optionLabel}>
              {FORMAT_LABELS[f]?.label ?? f}
              <span className={styles.voicesCount} aria-label={`${catalogue.speakers[f] ?? 1} voices`}>
                {'●'.repeat(catalogue.speakers[f] ?? 1)}
              </span>
            </span>
            <span className={styles.optionHint}>{FORMAT_LABELS[f]?.hint}</span>
          </label>
        ))}
      </fieldset>
      {languageChoices.length > 1 && (
        <fieldset className={styles.choice}>
          <legend>Language</legend>
          {languageChoices.map((l) => (
            <label key={l} className={styles.option}>
              <input type="radio" name="language" value={l} checked={language === l} onChange={() => pickLanguage(l)} />
              <span className={styles.optionLabel}>{LANGUAGE_LABELS[l] ?? l}</span>
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className={styles.cast}>
        <legend>Voices</legend>
        {Array.from({ length: count }, (_, speaker) => (
          <VoiceSelect
            key={speaker}
            speaker={speaker}
            role={roles[speaker] ?? `Speaker ${speaker + 1}`}
            voices={options}
            value={cast[speaker] ?? ''}
            onChange={(id) => pickVoice(speaker, id)}
            preview={preview}
          />
        ))}
        <p className={styles.fine}>
          A voice “over music” brings its music bed along. Add your own voice: put a 10–60 s .wav of clean speech (only voices whose owners agreed) in
          <code> .audio/voices/custom/</code>.
        </p>
      </fieldset>
      <div className={styles.makerActions}>
        <button type="submit" className="btn btn-primary" disabled={sending} aria-busy={sending || undefined}>
          {sending ? 'Queueing…' : exists ? 'Record it with these voices' : 'Write and record'}
        </button>
        {exists && (
          <label className={`${styles.fresh} workshop-only`}>
            <input type="checkbox" checked={fresh} onChange={(event) => setFresh(event.currentTarget.checked)} /> Write a fresh script too
          </label>
        )}
        <p className={styles.fine}>
          The script takes a few minutes. Recording runs on this machine and takes longer than the episode lasts; you can leave the page.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            Could not queue it: {error}
          </p>
        )}
      </div>
    </form>
  );
}

export default EpisodeMaker;
