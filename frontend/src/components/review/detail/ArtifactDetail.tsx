/**
 * One artifact under review: read it, proof it against its sources, compare it with the
 * previous version, correct it (a new human version, D15), approve, reject or re-run it.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { ArtifactPublic, ReviewAction } from '../../../lib/api/types/artifacts';
import type { SkillPublic } from '../../../lib/api/types/skills';
import { problemOf, type ProblemInfo } from '../../document/Problem';
import { blocksUnder, createArtifact, rerun, reviewArtifact, sourceLookup, type SourceBlock } from '../api';
import { adaptBody } from '../body/adapters';
import { ArtifactBody } from '../body/ArtifactBody';
import { Tabs, type TabSpec } from '../common/Tabs';
import { VersionDiff } from '../diff/VersionDiff';
import { BlockEditor } from '../editor/BlockEditor';
import { EvidencePanel } from '../evidence/EvidencePanel';
import { tallyGrounding } from '../evidence/grounding';
import { ProofView } from '../evidence/ProofView';
import { propagationNote, rerunKind, TYPE_LABELS } from '../labels';
import { DetailActions } from './DetailActions';
import { DetailHeader } from './DetailHeader';
import styles from './Detail.module.css';

export type DetailMode = 'read' | 'proof' | 'changes' | 'edit' | 'write';
type View = Exclude<DetailMode, 'edit' | 'write'>;

export interface ArtifactDetailProps {
  artifact: ArtifactPublic;
  versions: ArtifactPublic[];
  documentTitle: string;
  heading?: string | undefined;
  skills: SkillPublic[];
  initialMode?: DetailMode;
  initialCite?: string | null;
  api?: ApiClient;
  navigate?: (href: string) => void;
}

export function ArtifactDetail({
  artifact: initial,
  versions: initialVersions,
  documentTitle,
  heading,
  skills,
  initialMode = 'read',
  initialCite = null,
  api = browserApi,
  navigate = (href) => window.location.assign(href),
}: ArtifactDetailProps) {
  const [artifact, setArtifact] = useState(initial);
  const [versions, setVersions] = useState(initialVersions);
  const [mode, setMode] = useState<DetailMode>(initialMode);
  const [cite, setCite] = useState<string | null>(initialCite);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ReactNode>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [sources, setSources] = useState<SourceBlock[]>([]);

  const skill = skills.find((s) => s.name === artifact.skill);
  const lookup = useMemo(() => sourceLookup(api, artifact.document_id), [api, artifact.document_id]);
  const adapted = useMemo(() => adaptBody(artifact.type, artifact.body), [artifact]);
  const tally = useMemo(() => tallyGrounding(adapted.blocks), [adapted]);
  const editing = mode === 'edit' || mode === 'write';
  const rerunJob = rerunKind(artifact, skills);

  useEffect(() => {
    if (!editing || sources.length > 0) return;
    blocksUnder(api, artifact.document_id, artifact.anchor).then(setSources, () => setSources([]));
  }, [api, artifact.document_id, artifact.anchor, editing, sources.length]);

  const perform = useCallback(
    async (label: string, task: () => Promise<ReactNode>) => {
      setBusy(true);
      setProblem(null);
      setStatus(`${label}…`);
      try {
        setStatus(await task());
      } catch (error) {
        setStatus(null);
        setProblem(problemOf(error));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const review = (action: Exclude<ReviewAction, 'edit'>) =>
    perform(action === 'approve' ? 'Approving' : 'Rejecting', async () => {
      const next = await reviewArtifact(api, artifact.id, { action });
      setArtifact(next);
      setVersions((all) => all.map((v) => (v.id === next.id ? next : v)));
      const note = action === 'approve' ? propagationNote(next.type) : null;
      return (
        <p>
          {action === 'approve' ? 'Approved.' : 'Rejected. It will not be used downstream; re-run it or write it by hand.'} {note}
        </p>
      );
    });

  const saveEdit = async (body: Record<string, unknown>) => {
    const next = await reviewArtifact(api, artifact.id, { action: 'edit', body });
    setVersions((all) => [...all, next]);
    setArtifact(next);
    setMode('changes');
    const note = propagationNote(next.type);
    setStatus(
      <p>
        Saved as version {next.version}, written by you. The skill’s version stays for comparison. {next.review === 'approved' ? note : null}
      </p>,
    );
    window.history.replaceState(null, '', `/review/${next.id}`);
  };

  const saveNew = async (body: Record<string, unknown>) => {
    const created = await createArtifact(api, { document_id: artifact.document_id, type: artifact.type, anchor: artifact.anchor, body });
    navigate(`/review/${created.id}`);
  };

  const onRerun = () => {
    if (!rerunJob) return;
    void perform('Queueing', async () => {
      const accepted = await rerun(api, rerunJob, artifact);
      return (
        <p>
          {accepted.deduplicated ? 'A run for this scope is already queued.' : `Queued ${rerunJob} for ${artifact.anchor ?? 'the whole document'}.`}{' '}
          <a href={`/pipeline?document=${artifact.document_id}`}>Follow it on the pipeline</a>.
        </p>
      );
    });
  };

  const earlier = versions.filter((v) => v.version < artifact.version).length;
  const uncited = tally.total - tally.cited;
  const tabs: TabSpec<View>[] = [
    { key: 'read', label: 'Read' },
    { key: 'proof', label: 'Proof', hint: uncited ? `${uncited} uncited` : undefined },
    { key: 'changes', label: 'Changes', hint: earlier ? `vs v${artifact.version - 1}` : 'first version' },
  ];

  return (
    <div className={styles.detail}>
      <DetailHeader artifact={artifact} documentTitle={documentTitle} heading={heading} thresholds={skill?.gates} />
      <DetailActions
        artifact={artifact}
        rerun={rerunJob}
        busy={busy}
        editing={editing}
        status={status}
        problem={problem}
        onApprove={() => void review('approve')}
        onReject={() => void review('reject')}
        onEdit={() => setMode('edit')}
        onRerun={onRerun}
        onWrite={() => setMode('write')}
      />

      <div className={styles.layout}>
        <div className={styles.main}>
          {editing ? (
            <section aria-labelledby="editor-title" className={styles.editorSection}>
              <h2 id="editor-title" className={styles.sectionTitle}>
                {mode === 'edit' ? `Correct version ${artifact.version}` : `Write this ${TYPE_LABELS[artifact.type].toLowerCase()} by hand`}
              </h2>
              <BlockEditor
                key={mode}
                initialBody={mode === 'edit' ? artifact.body : { blocks: [] }}
                sources={sources}
                saveLabel={mode === 'edit' ? 'Save as a new version' : 'Save and approve'}
                onSave={mode === 'edit' ? saveEdit : saveNew}
                onCancel={() => setMode('read')}
              />
            </section>
          ) : (
            <Tabs tabs={tabs} active={mode as View} onChange={setMode} label="View">
              {mode === 'read' ? <ArtifactBody type={artifact.type} body={artifact.body} onCite={setCite} /> : null}
              {mode === 'proof' ? <ProofView blocks={adapted.blocks} onCite={setCite} /> : null}
              {mode === 'changes' ? <VersionDiff key={artifact.id} current={artifact} versions={versions} /> : null}
            </Tabs>
          )}
        </div>
        <div className={styles.side}>
          <EvidencePanel anchor={cite} lookup={lookup} onClose={() => setCite(null)} />
        </div>
      </div>
    </div>
  );
}

export default ArtifactDetail;
