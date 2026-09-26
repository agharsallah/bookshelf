/**
 * Document-wide jobs: re-parse, write the brief, and book-wide study material (glossary,
 * guide, and the quiz, FAQ, quotes and flashcards over the whole book). Re-runs queue a
 * job and say so in a toast; study material shows its job's live progress in place.
 */
import { useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { JobKind, JobPublic } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';
import { DeriveButton } from './DeriveButton';
import { enqueue, jobLabel, madeKey, needsDistillation, type EnqueueRequest } from './jobs';
import { useDeriveJobs } from './useDeriveJobs';
import styles from './DocumentActions.module.css';

export interface DocumentActionsProps {
  documentId: string;
  kinds?: JobKind[];
  /** Document-scope derive skills. */
  derive?: SkillPublic[];
  /** Whether any chapter distillation is approved (derive inputs exist). */
  distilled?: boolean;
  /** The document's recent jobs, so study buttons show their state before the stream opens. */
  initialJobs?: JobPublic[];
  /** Book-wide study material already made, by `madeKey(skill, null)` → artifact id. */
  made?: Record<string, string>;
}

export function DocumentActions(props: DocumentActionsProps) {
  const { derive = [] } = props;
  return derive.length > 0 ? <StudyActions {...props} derive={derive} /> : <RunActions {...props} />;
}

function RunActions({ documentId, kinds = [] }: DocumentActionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, request: EnqueueRequest) => {
    setBusy(key);
    await enqueue(browserApi, request);
    setBusy(null);
  };
  return (
    <div className={styles.actions}>
      {kinds.map((kind) => (
        <button key={kind} type="button" disabled={busy !== null} onClick={() => void run(kind, { kind, documentId })}>
          {busy === kind ? 'Queueing…' : jobLabel(kind)}
        </button>
      ))}
    </div>
  );
}

/** Book-wide study material: one `DeriveButton` per skill, following its latest job. */
function StudyActions({ documentId, derive = [], distilled = false, initialJobs = [], made = {} }: DocumentActionsProps) {
  const { jobFor, queue, now, track } = useDeriveJobs(documentId, initialJobs);
  return (
    <div className={styles.study}>
      {derive.map((skill) => (
        <DeriveButton
          key={skill.name}
          skill={skill}
          documentId={documentId}
          anchor={null}
          job={jobFor(skill.name, null)}
          queue={queue}
          now={now}
          madeId={made[madeKey(skill.name, null)] ?? null}
          blocked={needsDistillation(skill, 'document') && !distilled ? 'Needs approved chapter distillations first' : null}
          onJob={track}
        />
      ))}
    </div>
  );
}

export default DocumentActions;
