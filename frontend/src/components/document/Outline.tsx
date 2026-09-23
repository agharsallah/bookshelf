/**
 * The outline: chapters (collapsible) with their sections and page ranges, chips for
 * what exists (summary, distillation, drafts waiting) and actions that queue work,
 * including the chapter's study material (derive skills from `GET /skills`).
 * Server-rendered, hydrated only for the actions.
 */
import { anchorLabel } from '../../lib/anchors';
import { browserApi } from '../../lib/api/client';
import type { TreeNode } from '../../lib/api/types/documents';
import type { JobKind } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';
import type { ChapterStatus, Standing } from '../../lib/documents/artifacts';
import { pageSpan, sectionsOf } from '../../lib/documents/tree';
import { deriveLabel, enqueue, needsDistillation } from './jobs';
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
}

const STANDING_WORDS: Record<Standing, string> = {
  approved: 'approved',
  draft: 'draft',
  needs_review: 'needs review',
};

function Chip({ label, standing }: { label: string; standing: Standing | null }) {
  return (
    <span className={styles.chip} data-standing={standing ?? 'none'}>
      {label}
      <span className={styles.chipState}>{standing ? STANDING_WORDS[standing] : 'not yet'}</span>
    </span>
  );
}

export function Outline({ documentId, slug, units, statuses, actionable, derive = [] }: OutlineProps) {
  const read = (anchor: string) => `/documents/${slug}/read/${anchor}`;
  const run = (kind: JobKind, anchor: string) => void enqueue(browserApi, { kind, documentId, anchor });
  const make = (skill: SkillPublic, anchor: string) => void enqueue(browserApi, { kind: 'derive', documentId, anchor, skill });

  if (units.length === 0) {
    return <p className={styles.empty}>No chapters yet. They appear once the document is parsed.</p>;
  }

  return (
    <ol className={styles.outline}>
      {units.map((unit, index) => {
        const status = statuses[unit.anchor];
        const sections = sectionsOf(unit);
        const title = unit.heading ?? `Chapter ${index + 1}`;
        return (
          <li key={unit.anchor} className={styles.chapter} data-front={unit.meta.front_matter ? '' : undefined}>
            <details open={index < 12 && !unit.meta.front_matter}>
              <summary className={styles.summary}>
                <span className={styles.number} aria-hidden="true">
                  {unit.meta.front_matter ? '' : anchorLabel(unit.anchor)}
                </span>
                <span className={styles.title}>{title}</span>
                <span className={styles.pages}>{pageSpan(unit)}</span>
              </summary>
              <div className={styles.body}>
                <div className={styles.chips}>
                  <Chip label="Summary" standing={status?.summary ?? null} />
                  <Chip label="Distillation" standing={status?.distillation ?? null} />
                  {status && status.waiting > 0 ? (
                    <a className={styles.waiting} href="/review">
                      {status.waiting} waiting for review
                    </a>
                  ) : null}
                </div>
                <div className={styles.actions}>
                  <a className={styles.read} href={read(unit.anchor)}>
                    Read
                  </a>
                  {actionable ? (
                    <>
                      <button type="button" onClick={() => run('summarize', unit.anchor)}>
                        Summarize again
                      </button>
                      <button type="button" onClick={() => run('distil_chapter', unit.anchor)}>
                        Distil again
                      </button>
                    </>
                  ) : null}
                </div>
                {actionable && derive.length > 0 && !unit.meta.front_matter && !unit.meta.skip ? (
                  <div className={styles.derive} role="group" aria-label={`Study material for ${title}`}>
                    <span className={styles.deriveLabel}>Study material</span>
                    {derive.map((skill) => {
                      const blocked = needsDistillation(skill) && status?.distillation !== 'approved';
                      return (
                        <button
                          key={skill.name}
                          type="button"
                          disabled={blocked}
                          title={blocked ? 'Needs an approved chapter distillation first' : skill.description}
                          onClick={() => make(skill, unit.anchor)}
                        >
                          {deriveLabel(skill)}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {sections.length > 0 ? (
                  <ol className={styles.sections}>
                    {sections.map((section) => (
                      <li key={section.anchor} className={styles.section}>
                        <a href={read(section.anchor)}>{section.heading ?? anchorLabel(section.anchor)}</a>
                        <span className={styles.pages}>{pageSpan(section)}</span>
                        {actionable ? (
                          <button
                            type="button"
                            className={styles.sectionAction}
                            onClick={() => run('distil_section', section.anchor)}
                            aria-label={`Distil section ${section.heading ?? section.anchor} again`}
                          >
                            Distil
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

export default Outline;
