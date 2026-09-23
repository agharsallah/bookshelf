/**
 * Document-wide jobs: re-parse, write the brief, and document-scope study material
 * (a glossary). Each queues one job and says so in a toast.
 */
import { useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { JobKind } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';
import { deriveLabel, enqueue, jobLabel, needsDistillation, type EnqueueRequest } from './jobs';
import styles from './DocumentActions.module.css';

export interface DocumentActionsProps {
  documentId: string;
  kinds?: JobKind[];
  /** Document-scope derive skills. */
  derive?: SkillPublic[];
  /** Whether any chapter distillation is approved (derive inputs exist). */
  distilled?: boolean;
}

export function DocumentActions({ documentId, kinds = [], derive = [], distilled = false }: DocumentActionsProps) {
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
      {derive.map((skill) => {
        const blocked = needsDistillation(skill) && !distilled;
        return (
          <button
            key={skill.name}
            type="button"
            disabled={busy !== null || blocked}
            title={blocked ? 'Needs approved chapter distillations first' : skill.description}
            onClick={() => void run(skill.name, { kind: 'derive', documentId, skill })}
          >
            {busy === skill.name ? 'Queueing…' : deriveLabel(skill)}
          </button>
        );
      })}
    </div>
  );
}

export default DocumentActions;
