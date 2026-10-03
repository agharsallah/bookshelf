/**
 * What the inspection of an existing repository found (docs/BUILDS.md §7c): anything that
 * stands in the way (with its fix), the detected stack, the instruction files the agent
 * will read as the repo's conventions, and the tree folded to its top level — open a
 * directory to see inside — with the build's folder marked where it would go.
 */
import { useId, useState } from 'react';
import type { RepoInstructionFile, TargetInspection } from '../../lib/api/types/builds';
import { TOOLCHAIN_LABELS } from '../../lib/builds/advanced';
import { failingChecks } from '../../lib/builds/plan';
import { repoTree, type TreeNode } from '../../lib/builds/target-view';
import { Problem, type ProblemInfo } from '../common/Problem';
import context from './Context.module.css';
import fields from './Fields.module.css';
import { CheckList } from './PreflightPanel';
import styles from './Target.module.css';
import viewer from './Viewer.module.css';

export interface InspectionCardProps {
  /** `owner/name` or the path, for the heading. */
  where: string;
  inspection: TargetInspection | null;
  inspecting: boolean;
  problem: ProblemInfo | null;
  onRetry: () => void;
  folder: string;
  useInstructions: boolean;
}

function InstructionRow({ file, used }: { file: RepoInstructionFile; used: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className={context.section} data-off={!used || undefined}>
      <div className={styles.fileRow}>
        <code className={context.sectionTitle}>{file.path}</code>
        <button type="button" className={context.peek} aria-expanded={open} aria-controls={id} aria-label={`Preview ${file.path}`} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Preview'}
        </button>
      </div>
      {open ? (
        <pre id={id} className={`${viewer.text} ${context.sectionText}`} tabIndex={0}>
          {file.text}
        </pre>
      ) : null}
    </li>
  );
}

function Entry({ node, depth }: { node: TreeNode; depth: 1 | 2 }) {
  return (
    <span className={styles.entry} data-mark={node.mark ?? undefined} data-ghost={node.ghost || undefined}>
      <span className={styles.entryName}>
        {node.name}
        {node.dir ? '/' : ''}
      </span>
      {node.mark === 'target' ? <span className={styles.pill} data-tone="accent">{node.ghost ? 'your folder · new' : 'your folder'}</span> : null}
      {node.mark === 'contains' && depth === 1 && node.ghost ? <span className={styles.pill}>new</span> : null}
    </span>
  );
}

function TopEntry({ node }: { node: TreeNode }) {
  // The way down to your folder starts open; the rest stay folded.
  const [open, setOpen] = useState(node.mark !== null);
  const id = useId();
  if (!node.dir || node.children.length === 0) {
    return (
      <li className={styles.treeItem}>
        <span className={styles.twistySpace} aria-hidden="true" />
        <Entry node={node} depth={1} />
      </li>
    );
  }
  return (
    <li className={styles.treeItem}>
      <button type="button" className={styles.twisty} aria-expanded={open} aria-controls={id} aria-label={`${open ? 'Fold' : 'Open'} ${node.name}`} onClick={() => setOpen(!open)} />
      <Entry node={node} depth={1} />
      {open ? (
        <ul id={id} className={styles.subtree}>
          {node.children.map((child) => (
            <li key={child.path} className={styles.treeItem}>
              <Entry node={child} depth={2} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function InspectionCard({ where, inspection, inspecting, problem, onRetry, folder, useInstructions }: InspectionCardProps) {
  const survey = inspection?.survey ?? null;
  const failing = inspection ? failingChecks(inspection.problems) : [];
  const stack = survey ? [...survey.stack, ...survey.toolchains.map((t) => TOOLCHAIN_LABELS[t])] : [];
  return (
    <section className={styles.inspection} aria-labelledby="inspection-title" aria-busy={inspecting}>
      <div className={styles.inspectionHead}>
        <h4 id="inspection-title" className={styles.inspectionTitle}>
          In <code>{where}</code>
        </h4>
        <span className={fields.hint} role="status">
          {inspecting ? 'Looking at the repository…' : inspection && failing.length === 0 ? 'Nothing stands in the way.' : ''}
        </span>
      </div>
      {problem ? (
        <>
          <Problem inline title="The repository could not be checked." problem={problem} />
          <div>
            <button type="button" className="btn btn-quiet" onClick={onRetry}>
              Try again
            </button>
          </div>
        </>
      ) : null}
      <CheckList checks={failing} />
      {stack.length > 0 ? (
        <div className={context.block}>
          <span className={styles.blockLabel}>Detected stack</span>
          <ul className={fields.chips} aria-label="Detected stack">
            {stack.map((s) => (
              <li key={s} className={fields.chip}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {survey && survey.instructions.length > 0 ? (
        <div className={context.block}>
          <span className={styles.blockLabel}>
            Its instructions {useInstructions ? '— read by the agent as the repo’s conventions' : '— not read (switched off)'}
          </span>
          <ul className={context.sections} aria-label="Instruction files">
            {survey.instructions.map((f) => (
              <InstructionRow key={f.path} file={f} used={useInstructions} />
            ))}
          </ul>
        </div>
      ) : null}
      {survey && survey.tree.length > 0 ? (
        <div className={context.block}>
          <span className={styles.blockLabel}>The tree, and where the build goes</span>
          <ul className={styles.tree} aria-label="Repository tree">
            {repoTree(survey.tree, folder).map((n) => (
              <TopEntry key={n.path} node={n} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
