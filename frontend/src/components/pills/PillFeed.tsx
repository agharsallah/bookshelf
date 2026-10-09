/**
 * Pills (island, `/pills`): a vertical feed of one-idea pills, one per screen on a phone,
 * a tall centred column with its action rail on a wide screen, with story-style progress
 * on top (docs/PILLS.md §9). A thin view over `lib/pills`: the session state machine, the
 * prefetch buffer and the event queue live there, framework-free.
 *
 * Keys: j / ↓ / space next, k / ↑ previous, ← / → within a thread, s save, o open the
 * source passage, ? confusing, e too easy, Esc end. Cite chips and `o` open the passage in
 * the guide's drawer; figures and diagrams magnify in the reader's lightbox. Time here
 * counts as activity surface `pills`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAttention } from '../../lib/activity/useAttention';
import { browserApi } from '../../lib/api/client';
import { createPillsClient, type PillsClient } from '../../lib/pills/client';
import { configToQuery } from '../../lib/pills/config';
import { currentPill, flatIndex } from '../../lib/pills/session';
import type { StorageAdapter } from '../../lib/pills/storage';
import type { Feed, FeedConfig, Pill } from '../../lib/pills/types';
import { problemOf } from '../common/Problem';
import { toast } from '../document/toast';
import { Lightbox, type LightboxItem } from '../figures/Lightbox';
import { ReadInPlace, usePassageOpener } from '../guide/ReadInPlace';
import type { RecallApi } from '../recall/api';
import { ConfigSheet, type SheetOptions } from './ConfigSheet';
import { EndCard } from './EndCard';
import type { AnswerValue, KindContext } from './kinds';
import { citeReaderHref, feedKey, ownsKeys, primarySource } from './model';
import { PillCard, type Reaction } from './PillCard';
import { Progress } from './Progress';
import { SupplyPanel } from './SupplyPanel';
import { useDwell, useEmit, useEventQueue, useSessionStore } from './usePills';
import { useFeedScroll } from './useFeedScroll';
import { useFeedTop } from './useFeedTop';
import styles from './Feed.module.css';

/** Where the browser reaches the API: the same-origin proxy, like every island. */
export const PILLS_API_BASE = '/api';
const browserPills = createPillsClient({ baseUrl: PILLS_API_BASE });

/** Slides either side of the current one that are drawn; the rest hold their place empty. */
const DRAWN_AROUND = 2;

export interface PillFeedProps {
  initialConfig: FeedConfig;
  /** Start a saved feed (`?feed=`). */
  feedId?: string | null;
  /** Resume a session (`?session=`). */
  resume?: string | null;
  options: SheetOptions;
  feeds: Feed[];
  client?: PillsClient;
  reviewApi?: RecallApi;
  storage?: StorageAdapter;
}

export function PillFeed(props: PillFeedProps) {
  return (
    <ReadInPlace>
      <FeedView {...props} />
    </ReadInPlace>
  );
}

function FeedView({ initialConfig, feedId = null, resume = null, options, feeds: initialFeeds, client = browserPills, reviewApi = browserApi, storage }: PillFeedProps) {
  const queue = useEventQueue(client, storage);
  const { session, state } = useSessionStore(client, queue);
  const [config, setConfig] = useState(initialConfig);
  const [feeds, setFeeds] = useState(initialFeeds);
  const [sheet, setSheet] = useState(false);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [reactions, setReactions] = useState<ReadonlyMap<string, Reaction>>(new Map());
  const [magnified, setMagnified] = useState<LightboxItem | null>(null);
  const open = usePassageOpener();
  const active = state.status === 'active';
  const current = active ? currentPill(state) : null;
  const emit = useEmit(queue, state.sessionId);
  const { touch } = useDwell(current, emit);
  useAttention({ surface: 'pills', document: current?.document.slug, unit: current?.anchor, detail: current?.kind });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (resume) void session.resume(resume);
    else void session.start(feedId ? { feed_id: feedId } : { config: initialConfig });
  }, [session, resume, feedId, initialConfig]);

  const restart = useCallback(
    (request: { config: FeedConfig } | { feed_id: string }, url: string) => {
      setSaved(new Set());
      setReactions(new Map());
      setSheet(false);
      window.history.replaceState(window.history.state, '', url);
      void session.start(request);
    },
    [session],
  );

  const toggleSave = (pill: Pill) => {
    touch(pill);
    const on = !saved.has(pill.id);
    emit(on ? 'save' : 'unsave', pill);
    setSaved((s) => {
      const next = new Set(s);
      if (on) next.add(pill.id);
      else next.delete(pill.id);
      return next;
    });
  };

  const react = (pill: Pill, reaction: Reaction) => {
    if (reactions.get(pill.id) === reaction) return;
    touch(pill);
    emit(reaction, pill);
    setReactions((r) => new Map(r).set(pill.id, reaction));
  };

  const openSource = (pill: Pill, viaCite = false) => {
    touch(pill);
    emit('open_source', pill);
    if (viaCite) return;
    const target = primarySource(pill);
    if (open) open(target.slug, target.anchor);
    else window.location.assign(citeReaderHref(target));
  };

  const ctxFor = (pill: Pill): KindContext => ({
    mediaBase: PILLS_API_BASE,
    reviewApi,
    onMagnify: setMagnified,
    onAnswer: (value: AnswerValue) => {
      touch(pill);
      emit('answer', pill, { ...value });
    },
  });

  // Keys, while no sheet, drawer or lightbox has them.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event) => {
    if (sheet || magnified || ownsKeys(event.target, event.key)) return;
    const action = feedKey(event);
    if (!action || !active) return;
    event.preventDefault();
    if (action === 'next' || action === 'previous' || action === 'stepLeft' || action === 'stepRight' || action === 'end') {
      session[action]();
      return;
    }
    if (!current) return;
    if (action === 'save') toggleSave(current);
    else if (action === 'open') openSource(current);
    else react(current, action === 'tooEasy' ? 'too_easy' : 'confusing');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = state.groups;
  const closing = state.done && groups.length > 0;
  const { scroller, slideRef } = useFeedScroll({
    position: state.position,
    count: groups.length + (closing ? 1 : 0),
    onSettle: (index) => (index >= groups.length ? session.end() : session.goto(index)),
  });

  const length = state.session?.config.length ?? config.length;
  const setSize = length ?? -1;
  const at = flatIndex(state);
  /** Each group's first pill's place in the feed. */
  const offsets = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    for (const group of groups) {
      out.push(n);
      n += group.pills.length;
    }
    return out;
  }, [groups]);

  const saveFeed = async (name: string, next: FeedConfig) => {
    try {
      const feed = await client.createFeed({ name, config: next });
      setFeeds((f) => [...f, feed]);
      toast(`Saved the feed “${name}”.`, 'good');
    } catch (error) {
      toast(`The feed was not saved: ${problemOf(error).message}`, 'bad');
    }
  };

  const deleteFeed = async (feed: Feed) => {
    try {
      await client.deleteFeed(feed.id);
      setFeeds((f) => f.filter((x) => x.id !== feed.id));
    } catch (error) {
      toast(`The feed was not deleted: ${problemOf(error).message}`, 'bad');
    }
  };

  const fit = useFeedTop<HTMLDivElement, HTMLDivElement>();

  const again = () => restart({ config }, `/pills${configToQuery(config)}`);

  return (
    <div ref={fit.root} className={styles.feed}>
      <div ref={fit.bar} className={styles.bar}>
        {active && groups.length > 0 ? <Progress current={at} total={length} /> : <span />}
        <div className={styles.controls}>
          <button type="button" className="btn btn-quiet" onClick={() => setSheet(true)}>
            Feed settings
          </button>
          {active ? (
            <button type="button" className="btn btn-quiet" onClick={() => session.end()} aria-keyshortcuts="Escape">
              End
            </button>
          ) : null}
        </div>
      </div>
      {state.notice ? <p className={styles.notice}>{state.notice}</p> : null}

      {state.status === 'idle' || state.status === 'loading' ? (
        <div className={styles.column} aria-busy="true">
          <span className={`skeleton-bone ${styles.bone}`} />
        </div>
      ) : state.status === 'error' ? (
        <div className={styles.column} role="alert">
          <p className={styles.message}>The feed could not be started: {state.error}</p>
          <button type="button" className="btn btn-primary" onClick={again}>
            Try again
          </button>
        </div>
      ) : state.status === 'ending' || state.status === 'ended' ? (
        <div className={styles.column}>
          <EndCard summary={state.summary} error={state.error} onRetry={() => session.end()} onAgain={again} />
        </div>
      ) : groups.length === 0 ? (
        <div className={styles.column}>
          <p className={styles.message}>{state.done ? 'No pills to show for this feed yet.' : 'Looking for pills…'}</p>
          <button type="button" className="btn" onClick={() => setSheet(true)}>
            Change the feed
          </button>
        </div>
      ) : (
        <div ref={scroller} className={styles.scroller} role="feed" aria-busy={!state.done && state.cursor !== null} aria-label="Pills">
          {groups.map((group, index) => {
            const step = index === state.position ? state.step : 0;
            const pill = group.pills[step] ?? group.pills[0];
            const near = pill !== undefined && Math.abs(index - state.position) <= DRAWN_AROUND;
            return (
              <div key={group.key} ref={slideRef(index)} className={styles.slide} data-position={index}>
                {near && pill ? (
                  <PillCard
                    pill={pill}
                    ctx={ctxFor(pill)}
                    saved={saved.has(pill.id)}
                    reacted={reactions.get(pill.id) ?? null}
                    onSave={() => toggleSave(pill)}
                    onReact={(reaction) => react(pill, reaction)}
                    onOpenSource={() => openSource(pill, true)}
                    position={(offsets[index] ?? 0) + step}
                    setSize={setSize}
                    thread={
                      group.pills.length > 1
                        ? {
                            step,
                            size: group.pills.length,
                            title: pill.thread?.title ?? null,
                            onStep: (delta) => (delta > 0 ? session.stepRight() : session.stepLeft()),
                          }
                        : undefined
                    }
                  />
                ) : null}
              </div>
            );
          })}
          {closing ? (
            <div ref={slideRef(groups.length)} className={styles.slide} data-position={groups.length}>
              <div className={styles.closing}>
                <p>That is the session.</p>
                <button type="button" className="btn btn-primary" onClick={() => session.end()}>
                  See how it went
                </button>
              </div>
            </div>
          ) : null}
          {state.error ? (
            <p className={styles.message} role="alert">
              More pills could not be loaded.{' '}
              <button type="button" className="btn btn-quiet" onClick={() => session.goto(state.position)}>
                Try again
              </button>
            </p>
          ) : null}
        </div>
      )}

      <SupplyPanel supply={state.supply} onGenerate={(document, anchor) => client.generate({ document, anchors: [anchor] })} />

      {sheet ? (
        <ConfigSheet
          config={config}
          options={options}
          feeds={feeds}
          onApply={(next) => {
            setConfig(next);
            restart({ config: next }, `/pills${configToQuery(next)}`);
          }}
          onStartFeed={(feed) => {
            setConfig(feed.config);
            restart({ feed_id: feed.id }, `/pills?feed=${encodeURIComponent(feed.id)}`);
          }}
          onSaveFeed={saveFeed}
          onDeleteFeed={(feed) => void deleteFeed(feed)}
          onClose={() => setSheet(false)}
        />
      ) : null}
      {magnified ? <Lightbox items={[magnified]} index={0} onIndex={() => undefined} onClose={() => setMagnified(null)} /> : null}
    </div>
  );
}

export default PillFeed;
