/**
 * The feed's settings, in a sheet: what to draw from (books, papers, collections, paper
 * sets, concepts), the mode, the kinds, the length and spoilers; "Save as feed", and the
 * saved feeds as chips that start one. A modal <dialog>: Escape closes it unchanged.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FEED_LENGTHS, FEED_MODES, PILL_KINDS, type Feed, type FeedConfig, type FeedLength, type FeedSources, type PillGenre, type PillKind } from '../../lib/pills/types';
import { KIND_LABELS, lengthLabel, MODE_LABELS } from './model';
import styles from './ConfigSheet.module.css';

export interface SheetOptions {
  documents: { id: string; slug: string; title: string; genre: PillGenre }[];
  collections: { slug: string; name: string }[];
  paperSets: { id: string; name: string }[];
}

export interface ConfigSheetProps {
  config: FeedConfig;
  options: SheetOptions;
  feeds: readonly Feed[];
  onApply: (config: FeedConfig) => void;
  onStartFeed: (feed: Feed) => void;
  onSaveFeed: (name: string, config: FeedConfig) => Promise<void>;
  onDeleteFeed: (feed: Feed) => void;
  onClose: () => void;
}

type ListKey = Exclude<keyof FeedSources, 'genre'>;

const LENGTHS: readonly FeedLength[] = [...FEED_LENGTHS, null];

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function ConfigSheet({ config, options, feeds, onApply, onStartFeed, onSaveFeed, onDeleteFeed, onClose }: ConfigSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<FeedConfig>(config);
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal?.();
  }, []);

  const setSources = (key: ListKey, value: string) => setDraft((d) => ({ ...d, sources: { ...d.sources, [key]: toggle(d.sources[key], value) } }));
  const setKind = (kind: PillKind) =>
    setDraft((d) => {
      const next = toggle(d.kinds ?? [...PILL_KINDS], kind);
      return { ...d, kinds: next.length === PILL_KINDS.length || next.length === 0 ? null : next };
    });

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return options.documents.filter((d) => !q || d.title.toLowerCase().includes(q));
  }, [options.documents, filter]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSaveFeed(name.trim(), draft);
      setName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialog} className={styles.sheet} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onApply(draft);
        }}
      >
        <header className={styles.head}>
          <h2 id={titleId}>Your feed</h2>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </header>

        {feeds.length > 0 ? (
          <section className={styles.group} aria-label="Saved feeds">
            <ul className={styles.chips}>
              {feeds.map((feed) => (
                <li key={feed.id} className={styles.feedChip}>
                  <button type="button" onClick={() => onStartFeed(feed)}>
                    {feed.name}
                  </button>
                  <button type="button" aria-label={`Delete the feed ${feed.name}`} onClick={() => onDeleteFeed(feed)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <fieldset className={styles.group}>
          <legend>From</legend>
          <p className={styles.hint}>Nothing picked means the whole shelf.</p>
          {options.documents.length > 6 ? (
            <input type="search" className={styles.filter} placeholder="Find a book or paper" aria-label="Find a book or paper" value={filter} onChange={(e) => setFilter(e.target.value)} />
          ) : null}
          <div className={styles.options}>
            {shown.map((d) => (
              <label key={d.id}>
                <input type="checkbox" checked={draft.sources.documents.includes(d.slug)} onChange={() => setSources('documents', d.slug)} />
                {d.title}
                {d.genre !== 'book' ? <span className={styles.genre}>{d.genre}</span> : null}
              </label>
            ))}
          </div>
          {options.collections.length > 0 ? (
            <div className={styles.options} role="group" aria-label="Collections">
              {options.collections.map((c) => (
                <label key={c.slug}>
                  <input type="checkbox" checked={draft.sources.collections.includes(c.slug)} onChange={() => setSources('collections', c.slug)} />
                  {c.name}
                  <span className={styles.genre}>collection</span>
                </label>
              ))}
            </div>
          ) : null}
          {options.paperSets.length > 0 ? (
            <div className={styles.options} role="group" aria-label="Paper sets">
              {options.paperSets.map((s) => (
                <label key={s.id}>
                  <input type="checkbox" checked={draft.sources.paper_sets.includes(s.id)} onChange={() => setSources('paper_sets', s.id)} />
                  {s.name}
                  <span className={styles.genre}>paper set</span>
                </label>
              ))}
            </div>
          ) : null}
          {draft.sources.concepts.length > 0 ? (
            <ul className={styles.chips} aria-label="Concepts">
              {draft.sources.concepts.map((c) => (
                <li key={c} className={styles.feedChip}>
                  <span>{c}</span>
                  <button type="button" aria-label={`Remove the concept ${c}`} onClick={() => setSources('concepts', c)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Mode</legend>
          <div className={styles.segmented}>
            {FEED_MODES.map((mode) => (
              <label key={mode} title={MODE_LABELS[mode].hint}>
                <input type="radio" name="mode" checked={draft.mode === mode} onChange={() => setDraft((d) => ({ ...d, mode }))} />
                {MODE_LABELS[mode].label}
              </label>
            ))}
          </div>
          <p className={styles.hint}>{MODE_LABELS[draft.mode].hint}.</p>
          {draft.mode === 'explore' ? (
            <label className={styles.inline}>
              <input type="checkbox" checked={draft.spoilers} onChange={(e) => setDraft((d) => ({ ...d, spoilers: e.target.checked }))} />
              Include chapters I have not read yet
            </label>
          ) : null}
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Length</legend>
          <div className={styles.segmented}>
            {LENGTHS.map((length) => (
              <label key={String(length)}>
                <input type="radio" name="length" checked={draft.length === length} onChange={() => setDraft((d) => ({ ...d, length }))} />
                {lengthLabel(length)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>Kinds</legend>
          <div className={styles.kinds}>
            {PILL_KINDS.map((kind) => (
              <label key={kind}>
                <input type="checkbox" checked={draft.kinds === null || draft.kinds.includes(kind)} onChange={() => setKind(kind)} />
                {KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </fieldset>

        <section className={styles.group} aria-label="Save as a feed">
          <div className={styles.save}>
            <input type="text" placeholder="Name this feed" aria-label="Feed name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn" disabled={!name.trim() || saving} onClick={() => void save()}>
              Save as feed
            </button>
          </div>
        </section>

        <footer className={styles.foot}>
          <button type="submit" className="btn btn-primary">
            Start this feed
          </button>
        </footer>
      </form>
    </dialog>
  );
}
