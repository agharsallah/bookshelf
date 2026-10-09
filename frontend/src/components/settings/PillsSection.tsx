/**
 * Settings → Pills (docs/PILLS.md §5): whether a feed running low composes new pills on its
 * own (`make-pills`, a few chapters at a time) and how many chapters a day it may spend
 * tokens on. Kept on the server (`PATCH /settings {pills}`); a change shows at once and
 * rolls back if refused.
 */
import { useEffect, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { PillsSettings, SettingsPublic } from '../../lib/api/types/settings';
import { problemOf } from '../common/Problem';
import { Check, Row, Section, Segmented } from './Controls';
import styles from './Settings.module.css';

const CAPS = [1, 2, 4, 8, 16] as const;

/** The daily caps offered, plus the saved one when it is not among them (set by the API). */
export const capOptions = (saved: number) =>
  [...new Set([...CAPS, saved])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: String(n) }));

export function PillsSection({ api = browserApi }: { api?: Pick<ApiClient, 'get' | 'patch'> }) {
  const [pills, setPills] = useState<PillsSettings | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.get<SettingsPublic>('settings').then(
      (s) => setPills(s.pills),
      (error: unknown) => setStatus(problemOf(error).message),
    );
  }, [api]);

  const save = async (patch: Partial<PillsSettings>) => {
    const before = pills;
    if (before) setPills({ ...before, ...patch });
    try {
      setPills((await api.patch<SettingsPublic>('settings', { pills: patch })).pills);
      setStatus('Saved.');
    } catch (error) {
      setPills(before);
      setStatus(`Not saved: ${problemOf(error).message}`);
    }
  };

  return (
    <Section
      id="pills"
      eyebrow="Pills"
      title="Composing new pills"
      hint="Most pills are gathered from material the pipeline already wrote, at no cost. When a feed runs low, the make-pills skill can write hooks and threads for chapters that have none, a few at a time."
    >
      {pills === null ? null : (
        <>
          <Row label="When a feed runs low">
            <Check
              label="Compose pills for the next chapters"
              hint="Only chapters already distilled; nothing runs when a book is added."
              checked={pills.auto_generate}
              onChange={(auto_generate) => void save({ auto_generate })}
            />
          </Row>
          <Row label="Chapters a day">
            <div className={styles.checks}>
              <Segmented
                label="Chapters a day"
                value={String(pills.max_chapters_per_day)}
                options={capOptions(pills.max_chapters_per_day)}
                onChange={(next) => void save({ max_chapters_per_day: Number(next) })}
              />
              <p className={styles.sample}>The most chapters composed on their own in a day. &ldquo;Make pills&rdquo; on the feed is not capped.</p>
            </div>
          </Row>
        </>
      )}
      <p className={styles.status} role="status">{status}</p>
    </Section>
  );
}
