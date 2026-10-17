/**
 * "What the agent will read" (docs/BUILDS.md §7): closed, one line says it all
 * (`Paper brief · 1 840 words · 7 of 9 sections · 3 references · notes`). Open: a row per
 * section of the paper brief to switch it off or read it, the references, your notes, and
 * *Preview files* to see the exact files rendered with the form as it stands.
 */
import { useEffect, useId, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildOptionsInput, BuildReference, ContextPreview, ContextSection, ContextSectionKey } from '../../lib/api/types/builds';
import { getContextPreview, renderContext } from '../../lib/builds/api';
import { CONTEXT_LIMITS, contextSummary, formatCount, isDefaultContext } from '../../lib/builds/context';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import styles from './Context.module.css';
import { ContextDialog } from './ContextDialog';
import { Counter, Disclosure, Switch } from './Disclosure';
import fields from './Fields.module.css';
import { ReferencesEditor } from './ReferencesEditor';
import viewer from './Viewer.module.css';

export interface ContextValue {
  sectionsOff: ContextSectionKey[];
  references: BuildReference[];
  notes: string;
}

export interface ContextPanelProps {
  api: Pick<ApiClient, 'get' | 'post'>;
  paperRef: string;
  value: ContextValue;
  onChange: (patch: Partial<ContextValue>) => void;
  linkPaper: boolean;
  allowWeb: boolean;
  errors: { notes?: string | undefined; references?: string | undefined };
  /** The form's options as they stand, for *Preview files*. */
  options: () => BuildOptionsInput;
  extraCommands: readonly string[];
}

function SectionRow({ section, on, onToggle }: { section: ContextSection; on: boolean; onToggle: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={styles.section} data-off={!on || undefined}>
      <div className={styles.sectionRow}>
        <Switch label={`Include ${section.title}`} hidden checked={on} onChange={onToggle} />
        <span className={styles.sectionTitle}>{section.title}</span>
        <span className={styles.words}>{formatCount(section.words)} words</span>
        <button type="button" className={styles.peek} aria-expanded={open} aria-controls={id} aria-label={`Preview ${section.title}`} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Preview'}
        </button>
      </div>
      {open ? (
        <pre id={id} className={`${viewer.text} ${styles.sectionText}`} tabIndex={0}>
          {section.markdown}
        </pre>
      ) : null}
    </li>
  );
}

export function ContextPanel({ api, paperRef, value, onChange, linkPaper, allowWeb, errors, options, extraCommands }: ContextPanelProps) {
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [viewing, setViewing] = useState(false);
  const notesId = useId();

  useEffect(() => {
    let live = true;
    getContextPreview(api, paperRef, linkPaper).then(
      (p) => {
        if (!live) return;
        setPreview(p);
        setProblem(null);
      },
      (error: unknown) => live && setProblem(problemOf(error)),
    );
    return () => {
      live = false;
    };
  }, [api, paperRef, linkPaper]);

  const { sectionsOff: off, references, notes } = value;
  const sections = preview?.sections ?? null;
  const toggle = (key: ContextSectionKey, on: boolean) => onChange({ sectionsOff: on ? off.filter((k) => k !== key) : [...off, key] });
  const allOn = !sections || sections.every((s) => !off.includes(s.key));
  const allOff = sections !== null && sections.every((s) => off.includes(s.key));

  return (
    <Disclosure title="What the agent will read" meta={contextSummary({ sections, off, references, notes })} forceOpen={Boolean(errors.notes ?? errors.references)}>
      <p className={styles.lede}>The planner and the agent read only this, offline. Switch off what could mislead the build, add what it should read beside the paper.</p>

      <section className={styles.block} aria-labelledby="brief-title">
        <div className={styles.blockHead}>
          <h4 id="brief-title" className={styles.blockTitle}>
            Paper brief <span className={styles.path}>docs/PAPER.md</span>
          </h4>
          {sections ? (
            <div className={styles.quick} role="group" aria-label="Sections">
              <button type="button" className={styles.peek} disabled={allOn} onClick={() => onChange({ sectionsOff: [] })}>
                All
              </button>
              <button type="button" className={styles.peek} disabled={allOff} onClick={() => onChange({ sectionsOff: sections.map((s) => s.key) })}>
                None
              </button>
            </div>
          ) : null}
        </div>
        {problem ? <Problem inline title="The paper brief could not be read." problem={problem} /> : null}
        {!sections && !problem ? (
          <p className={fields.status} role="status">
            Reading the paper brief…
          </p>
        ) : null}
        {sections ? (
          <ul className={styles.sections}>
            {sections.map((s) => (
              <SectionRow key={s.key} section={s} on={!off.includes(s.key)} onToggle={(on) => toggle(s.key, on)} />
            ))}
          </ul>
        ) : null}
        {allOff ? <p className={styles.note}>With every section off, the agent knows the paper only by its title and your goal.</p> : null}
      </section>

      <ReferencesEditor
        api={api}
        paperRef={paperRef}
        suggestions={preview?.suggested_references ?? []}
        references={references}
        onChange={(next) => onChange({ references: next })}
        allowWeb={allowWeb}
        error={errors.references}
      />

      <section className={styles.block}>
        <div className={styles.blockHead}>
          <label htmlFor={notesId} className={styles.blockTitle}>
            Your notes <span className={styles.path}>docs/NOTES.md</span>
          </label>
          <Counter id={`${notesId}-count`} length={notes.length} max={CONTEXT_LIMITS.notes} />
        </div>
        <textarea
          id={notesId}
          className={fields.textarea}
          placeholder="What you know that the paper does not say: a pitfall, a dataset to use, how you want it explained…"
          value={notes}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={`${notesId}-count`}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
        {errors.notes ? <p className={fields.error}>{errors.notes}</p> : null}
      </section>

      <div className={styles.footer}>
        <button type="button" className="btn" data-demo-off onClick={() => setViewing(true)}>
          Preview files
        </button>
        <span className={fields.hint}>The exact files, kickoff and tools, rendered from this form.</span>
        <button type="button" className="btn btn-quiet" disabled={isDefaultContext({ off, references, notes })} onClick={() => onChange({ sectionsOff: [], references: [], notes: '' })}>
          Reset
        </button>
      </div>
      <ContextDialog open={viewing} onClose={() => setViewing(false)} load={() => renderContext(api, paperRef, options())} extraCommands={extraCommands} />
    </Disclosure>
  );
}
