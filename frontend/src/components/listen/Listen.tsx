/**
 * The Listen page (island): a book's audio summaries. Pick an episode (5, 15 or 30 min,
 * narrator to roundtable) and, when it was recorded with more than one cast, the voices;
 * play it with the transcript following along; download it; or make a new one.
 *
 * Jobs making audio (writing a script, recording it) show live from `/jobs/stream`; when
 * one finishes, the episodes are fetched again so the new recording appears in place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { AudioShelf, VoiceCatalogue } from '../../lib/api/types/audio';
import type { SkillParam } from '../../lib/api/types/skills';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { describeJob } from '../../lib/jobs/progress';
import { AudioPlayer } from './AudioPlayer';
import { EpisodeMaker } from './EpisodeMaker';
import {
  apiPath,
  audioJobTitle,
  castNames,
  downloadName,
  episodeLabel,
  FORMAT_LABELS,
  isAudioJob,
  parseScript,
  pickRender,
  positionKey,
} from './listening';
import { Transcript } from './Transcript';
import styles from './Listen.module.css';

export interface ListenProps {
  slug: string;
  bookTitle: string;
  documentId: string;
  shelf: AudioShelf;
  catalogue: VoiceCatalogue;
  /** The audio skill's params, or null when the skill is not installed (nothing to make). */
  params: Record<string, SkillParam> | null;
  api?: Pick<ApiClient, 'get' | 'post' | 'delete'>;
}

export function Listen({ slug, bookTitle, documentId, shelf: initial, catalogue, params, api = browserApi }: ListenProps) {
  const [shelf, setShelf] = useState(initial);
  const [variant, setVariant] = useState<string | null>(() => initial.episodes.find((e) => e.renders.length > 0)?.variant ?? initial.episodes[0]?.variant ?? null);
  const [renderKey, setRenderKey] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [making, setMaking] = useState(initial.episodes.length === 0);
  const audio = useRef<HTMLAudioElement>(null);
  const { jobs, queue, track } = useJobStream({ documentId });
  const [now, setNow] = useState(() => Date.now());

  const episode = shelf.episodes.find((e) => e.variant === variant) ?? shelf.episodes[0];
  const render = pickRender(episode, renderKey);
  const script = useMemo(() => (episode ? parseScript(episode.script.body) : null), [episode]);
  const audioJobs = Object.values(jobs).filter(isAudioJob);
  const live = audioJobs.filter((job) => job.state === 'queued' || job.state === 'running');
  const finished = audioJobs.filter((job) => job.state === 'done' || job.state === 'skipped').map((job) => job.id).sort().join(',');

  // A job that finished may have made a script or a recording: fetch the episodes again.
  useEffect(() => {
    if (!finished) return;
    let stale = false;
    api
      .get<AudioShelf>(`documents/${encodeURIComponent(documentId)}/audio`)
      .then((next) => {
        if (!stale) setShelf(next);
      })
      .catch(() => undefined); // the old list stays; the next finished job tries again
    return () => {
      stale = true;
    };
  }, [api, documentId, finished]);

  useEffect(() => {
    if (live.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live.length]);

  const onTime = useCallback((seconds: number) => setTime(seconds), []);
  const seek = (seconds: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = seconds;
    void el.play().catch(() => undefined);
  };

  const speakers = script
    ? script.speakers.map((speaker, i) => {
        const role = FORMAT_LABELS[String(episode?.params.format)]?.roles[i] ?? speaker.role;
        const voice = render ? castNames([render.voices[i] ?? ''], catalogue.voices) : '';
        return voice ? `${role} · ${voice}` : role;
      })
    : [];

  return (
    <div className={styles.listen}>
      {shelf.episodes.length > 0 && (
        <nav className={styles.episodes} aria-label="Episodes">
          <ul role="list">
            {shelf.episodes.map((e) => (
              <li key={e.variant}>
                <button
                  type="button"
                  className={styles.episode}
                  aria-pressed={e.variant === episode?.variant}
                  onClick={() => {
                    setVariant(e.variant);
                    setRenderKey(null);
                    setTime(0);
                  }}
                >
                  <span className={styles.episodeLabel}>{episodeLabel(e.params)}</span>
                  <span className={styles.episodeMeta}>
                    {e.renders.length === 0 ? 'Not recorded yet' : e.script.review === 'approved' ? 'Reviewed' : 'Draft'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {live.length > 0 && (
        <ul className={styles.working} aria-label="In the works" aria-live="polite">
          {live.map((job) => (
            <li key={job.id}>
              <span className={styles.spinner} aria-hidden="true" />
              {audioJobTitle(job, shelf.episodes, catalogue.voices)}
              <span className={styles.workingState}>{describeJob(job, now, queue).text}</span>
            </li>
          ))}
        </ul>
      )}

      {episode && script && (
        <article className={styles.episodeView} aria-labelledby="episode-title">
          <header className={styles.episodeHead}>
            <p className={styles.kicker}>{episodeLabel(episode.params)}</p>
            <h2 id="episode-title">{script.title}</h2>
            {episode.script.review !== 'approved' && (
              <p className={styles.draft}>
                Draft, not reviewed yet. <a href={`/review/${episode.script.id}`}>Review the script</a>
              </p>
            )}
            {episode.renders.length > 1 && (
              <label className={styles.castPick}>
                Voices
                <select value={render?.key ?? ''} onChange={(event) => setRenderKey(event.currentTarget.value)}>
                  {episode.renders.map((r) => (
                    <option key={r.key} value={r.key}>
                      {castNames(r.voices, catalogue.voices)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>
          {render ? (
            <AudioPlayer
              key={render.key}
              audio={audio}
              src={apiPath(render.url)}
              downloadHref={apiPath(render.url, { download: downloadName(bookTitle, episode.params) })}
              downloadName={downloadName(bookTitle, episode.params)}
              title={script.title}
              bookTitle={bookTitle}
              sections={render.sections}
              duration={render.duration}
              storageKey={positionKey(render)}
              onTime={onTime}
            />
          ) : (
            <p className={styles.unrecorded}>
              {live.some((job) => job.kind === 'narrate') ? 'Recording now. It appears here when it is ready; the script is below.' : 'Not recorded yet. Choose voices below and record it.'}
            </p>
          )}
          <Transcript
            slug={slug}
            script={script}
            speakers={speakers}
            sections={render?.sections ?? null}
            turns={render?.turns ?? null}
            time={render ? time : -1}
            onSeek={seek}
          />
        </article>
      )}

      {params && (
        <section className={styles.make} aria-labelledby="make-title">
          <h2 id="make-title" className={styles.makeTitle}>
            {shelf.episodes.length === 0 ? 'Make an audio summary' : 'New episode'}
          </h2>
          {making ? (
            <EpisodeMaker
              documentId={documentId}
              catalogue={catalogue}
              params={params}
              existing={shelf.episodes.map((e) => e.variant)}
              onQueued={(job) => track(job)}
              api={api}
            />
          ) : (
            <button type="button" className="btn" onClick={() => setMaking(true)}>
              Choose a length, format and voices
            </button>
          )}
        </section>
      )}
    </div>
  );
}

export default Listen;
