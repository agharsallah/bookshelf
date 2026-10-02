/**
 * The outline: one row per chapter, as a book's contents page, with its title opening
 * the reader where you left off, the one status worth flagging and how far you have read.
 * Each chapter's details open on request (or all at once): the chapter's own study
 * material and its sections; in workshop mode also what exists (summary, distillation),
 * re-runs that queue work and the study material to make (derive skills from
 * `GET /skills`, each with its job's live progress). Server-rendered, hydrated for the
 * toggles and actions.
 */
import { useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import type { JobKind, JobPublic } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';
import type { ChapterStatus } from '../../lib/documents/artifacts';
import type { AvailableMaterial } from '../../lib/documents/study';
import { contentsSummary } from './contents';
import { ContentsRow } from './ContentsRow';
import { DeriveButton } from './DeriveButton';
import { enqueue, madeKey, needsDistillation } from './jobs';
import { useDeriveJobs } from './useDeriveJobs';
import styles from './Outline.module.css';

export interface OutlineProps {
  documentId: string;
  slug: string;
  units: TreeNode[];
  statuses: Record<string, ChapterStatus>;
  /** Whether jobs can be queued (the document is parsed). */
  actionable: boolean;
  /** Chapter-scope derive skills (quiz, FAQ, quotes, flashcards). */
  derive?: SkillPublic[];
  /** The document's recent jobs, so study buttons show their state before the stream opens. */
  initialJobs?: JobPublic[];
  /** Study material already made, by `madeKey(skill, anchor)` → artifact id. */
  made?: Record<string, string>;
  /** Your place in each chapter read so far, by chapter anchor. */
  positions?: Record<string, ReadingPosition>;
  /** Each chapter's own study material that exists, by chapter anchor. */
  study?: Record<string, AvailableMaterial[]>;
  /** The chapter you are in, marked in the list. */
  current?: string | null;
  /** The collection the page was reached from, kept in each reader link. */
  collection?: string | null;
}

export function Outline({ documentId, slug, units, statuses, actionable, derive = [], initialJobs = [], made = {}, positions = {}, study = {}, current = null, collection = null }: OutlineProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const run = (kind: JobKind, anchor: string) => void enqueue(browserApi, { kind, documentId, anchor });
  const { jobFor, queue, now, track } = useDeriveJobs(documentId, initialJobs);

  if (units.length === 0) {
    return <p className={styles.empty}>No chapters yet. They appear once the document is parsed.</p>;
  }

  const allOpen = open.size === units.length;
  const summary = contentsSummary(units, statuses);
  const toggle = (anchor: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(anchor)) next.add(anchor);
      return next;
    });

  const toolsFor = (unit: TreeNode, title: string) => {
    if (!actionable) return undefined;
    const status = statuses[unit.anchor];
    const studies = derive.length > 0 && !unit.meta.front_matter && !unit.meta.skip;
    return (
      <div className={`${styles.workshopTools} workshop-only`}>
        {studies ? (
          <div className={styles.group} role="group" aria-label={`Make study material for ${title}`}>
            <span className={styles.groupLabel}>Make study material</span>
            <div className={styles.derive}>
              {derive.map((skill) => (
                <DeriveButton
                  key={skill.name}
                  skill={skill}
                  documentId={documentId}
                  anchor={unit.anchor}
                  job={jobFor(skill.name, unit.anchor)}
                  queue={queue}
                  now={now}
                  madeId={made[madeKey(skill.name, unit.anchor)] ?? null}
                  blocked={needsDistillation(skill) && status?.distillation !== 'approved' ? 'Needs an approved chapter distillation first' : null}
                  onJob={track}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className={styles.group} role="group" aria-label={`Run again for ${title}`}>
          <span className={styles.groupLabel}>Run again</span>
          <div className={styles.actions}>
            <button type="button" onClick={() => run('summarize', unit.anchor)}>
              Summarize
            </button>
            <button type="button" onClick={() => run('distil_chapter', unit.anchor)}>
              Distil chapter
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.contents}>
      <div className={styles.bar}>
        <p className={styles.summaryLine}>
          {summary.chapters}
          {summary.work ? <span className="workshop-only"> · {summary.work}</span> : null}
        </p>
        <button type="button" className={styles.expandAll} onClick={() => setOpen(allOpen ? new Set() : new Set(units.map((u) => u.anchor)))}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <ol className={styles.outline}>
        {units.map((unit, index) => (
          <ContentsRow
            key={unit.anchor}
            unit={unit}
            index={index}
            slug={slug}
            collection={collection}
            status={statuses[unit.anchor]}
            position={positions[unit.anchor]}
            open={open.has(unit.anchor)}
            onToggle={() => toggle(unit.anchor)}
            tools={toolsFor(unit, unit.heading ?? `Chapter ${index + 1}`)}
            study={study[unit.anchor] ?? []}
            current={unit.anchor === current}
            onDistilSection={actionable ? (anchor) => run('distil_section', anchor) : undefined}
          />
        ))}
      </ol>
    </div>
  );
}

export default Outline;
