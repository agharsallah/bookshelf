/**
 * Listen to the chapter you are reading, read aloud as written: a dock in the reader with
 * the audio player, the passage being read marked in the text (and followed, unless you
 * turn that off), "play from where I am", and — before there is a recording, or for
 * another voice — the form that records one (`POST /jobs {kind: narrate, anchor, voices}`).
 *
 * The same player, voices and timeline as the Listen page's summaries; only the script
 * differs: the chapter's own words (`GET /documents/{ref}/audio/read/{anchor}`), each turn
 * citing the block it reads. A recording in the works shows live; when it finishes, the
 * chapter's audio is fetched again so it plays in place.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { ChapterAudio, VoiceCatalogue } from '../../lib/api/types/audio';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { enqueueJob } from '../../lib/jobs/api';
import { describeJob } from '../../lib/jobs/progress';
import { problemOf } from '../common/Problem';
import { AudioPlayer } from './AudioPlayer';
import {
  apiPath,
  audioJobTitle,
  castNames,
  defaultCast,
  listeningTime,
  parseScript,
  positionKey,
  readingDownloadName,
  speakingAnchor,
  startFrom,
  voicesFor,
} from './listening';
import { useVoicePreview, VoiceSelect } from './VoiceSelect';
import styles from './ChapterListen.module.css';

export interface ChapterListenProps {
  documentId: string;
  bookTitle: string;
  /** The chapter (or part, or section) the reader shows, and its heading. */
  anchor: string;
  chapter: string;
  language?: string;
  /** The passage you are at, and the chapter's blocks in reading order, for "play from here". */
  activeAnchor: string | null;
  order: ReadonlyMap<string, number>;
  /** The passage being read aloud (null: none), and whether to keep it in view. */
  onSpeaking: (anchor: string | null, follow: boolean) => void;
  onClose: () => void;
  api?: Pick<ApiClient, 'get' | 'post' | 'delete'>;
}

/** `ch01/s02` as a path under `audio/read/`, each segment escaped. */
function anchorPath(anchor: string): string {
  return anchor.split('/').map(encodeURIComponent).join('/');
}

export function ChapterListen(props: ChapterListenProps) {
  const { documentId, bookTitle, anchor, chapter, language = 'en', activeAnchor, order, onSpeaking, onClose, api = browserApi } = props;
  const [data, setData] = useState<ChapterAudio | null>(null);
  const [catalogue, setCatalogue] = useState<VoiceCatalogue | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [renderKey, setRenderKey] = useState<string | null>(null);
  const [voice, setVoice] = useState('');
  const [recordAnother, setRecordAnother] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [time, setTime] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<HTMLAudioElement>(null);
  const spoken = useRef<string | null>(null);
  const preview = useVoicePreview();
  const { jobs, queue, track } = useJobStream({ documentId });

  const script = useMemo(() => (data ? parseScript(data.script) : null), [data]);
  const render = data?.renders.find((r) => r.key === renderKey) ?? data?.renders[0] ?? null;
  const readings = Object.values(jobs).filter((job) => job.kind === 'narrate' && job.anchor === anchor);
  const live = readings.filter((job) => job.state === 'queued' || job.state === 'running');
  const finished = readings.filter((job) => job.state === 'done' || job.state === 'skipped').map((job) => job.id).sort().join(',');
  const options = useMemo(() => (catalogue ? voicesFor(catalogue.voices, language) : []), [catalogue, language]);

  const load = useCallback(
    () => api.get<ChapterAudio>(`documents/${encodeURIComponent(documentId)}/audio/read/${anchorPath(anchor)}`),
    [api, documentId, anchor],
  );

  // The chapter's script and recordings, and the voices to record it with.
  useEffect(() => {
    let stale = false;
    Promise.all([load(), api.get<VoiceCatalogue>('audio/voices')])
      .then(([chapterAudio, voices]) => {
        if (stale) return;
        setData(chapterAudio);
        setCatalogue(voices);
        setVoice((current) => current || (defaultCast(voices, language, 1)[0] ?? ''));
      })
      .catch((error: unknown) => {
        if (!stale) setProblem(problemOf(error).message);
      });
    return () => {
      stale = true;
    };
  }, [api, load, language]);

  // A recording finished: fetch the chapter again so it plays here.
  useEffect(() => {
    if (!finished) return;
    let stale = false;
    load()
      .then((next) => {
        if (stale) return;
        setData(next);
        setRecordAnother(false);
      })
      .catch(() => undefined); // the old list stays; the next finished job tries again
    return () => {
      stale = true;
    };
  }, [load, finished]);

  useEffect(() => {
    if (live.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live.length]);

  // Tell the reader which passage is being read, once per change; nothing once closed.
  useEffect(() => {
    const at = script && render && time > 0 ? speakingAnchor(script, render.turns, time) : null;
    if (at === spoken.current) return;
    spoken.current = at;
    onSpeaking(at, follow);
  }, [script, render, time, follow, onSpeaking]);
  useEffect(() => () => onSpeaking(null, false), [onSpeaking]);

  const onTime = useCallback((seconds: number) => setTime(seconds), []);
  const playFromHere = () => {
    const el = audio.current;
    const at = script && render && activeAnchor ? startFrom(script, render.turns, activeAnchor, order) : null;
    if (!el || at === null) return;
    el.currentTime = at;
    void el.play().catch(() => undefined);
  };

  const record = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setSendError(null);
    try {
      const accepted = await enqueueJob(api, { kind: 'narrate', document_id: documentId, anchor, voices: [voice] });
      track(accepted.job);
    } catch (error) {
      setSendError(problemOf(error).message);
    } finally {
      setSending(false);
    }
  };

  const nothingToRead = data !== null && script === null;
  const showForm = catalogue !== null && !nothingToRead && (render === null || recordAnother);
  const download = readingDownloadName(bookTitle, chapter);

  return (
    <section className={styles.dock} aria-labelledby="chapter-listen-title">
      <header className={styles.head}>
        <div>
          <p className={styles.kicker}>Listen{data && script ? ` · ${listeningTime(data.words)}` : ''}</p>
          <h2 id="chapter-listen-title" className={styles.title}>
            {chapter}
          </h2>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close the player">
          ×
        </button>
      </header>

      {problem ? (
        <p className={styles.error} role="alert">
          The chapter’s audio could not be loaded: {problem}
        </p>
      ) : !data ? (
        <p className={styles.note} aria-live="polite">
          Loading…
        </p>
      ) : nothingToRead ? (
        <p className={styles.note}>This chapter has nothing to read aloud: only tables, code or formulas.</p>
      ) : render && script ? (
        <>
          {data.renders.length > 1 && catalogue && (
            <label className={styles.pick}>
              Voice
              <select value={render.key} onChange={(event) => setRenderKey(event.currentTarget.value)}>
                {data.renders.map((r) => (
                  <option key={r.key} value={r.key}>
                    {castNames(r.voices, catalogue.voices)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <AudioPlayer
            key={render.key}
            audio={audio}
            src={apiPath(render.url)}
            downloadHref={apiPath(render.url, { download })}
            downloadName={download}
            title={chapter}
            bookTitle={bookTitle}
            sections={render.sections}
            duration={render.duration}
            storageKey={positionKey(render)}
            onTime={onTime}
            shortcuts={false}
          />
          <div className={styles.row}>
            <button type="button" className="btn btn-quiet" onClick={playFromHere} disabled={!activeAnchor}>
              Play from where I am
            </button>
            <label className={styles.toggle}>
              <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.currentTarget.checked)} /> Follow along in the text
            </label>
            {!recordAnother && catalogue && (
              <button type="button" className="btn btn-quiet" onClick={() => setRecordAnother(true)}>
                Another voice
              </button>
            )}
          </div>
        </>
      ) : (
        <p className={styles.note}>{live.length > 0 ? 'Recording now. It plays here when it is ready; keep reading meanwhile.' : 'Not recorded yet. Choose a voice to read it aloud.'}</p>
      )}

      {live.length > 0 && catalogue && (
        <ul className={styles.working} aria-label="In the works" aria-live="polite">
          {live.map((job) => (
            <li key={job.id}>
              <span className={styles.spinner} aria-hidden="true" />
              {audioJobTitle(job, [], catalogue.voices)}
              <span className={styles.state}>{describeJob(job, now, queue).text}</span>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form className={styles.form} onSubmit={(event) => void record(event)}>
          <VoiceSelect role="Reader" voices={options} value={voice} onChange={setVoice} preview={preview} />
          <div className={styles.row}>
            <button type="submit" className="btn btn-primary" disabled={sending || !voice} aria-busy={sending || undefined}>
              {sending ? 'Queueing…' : 'Read it aloud'}
            </button>
            {recordAnother && (
              <button type="button" className="btn btn-quiet" onClick={() => setRecordAnother(false)}>
                Cancel
              </button>
            )}
          </div>
          <p className={styles.note}>The text is read as written; tables, code and formulas are skipped. Recording runs on this machine and takes a while.</p>
          {sendError && (
            <p className={styles.error} role="alert">
              Could not queue it: {sendError}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export default ChapterListen;
