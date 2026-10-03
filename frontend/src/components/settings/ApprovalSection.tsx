/** Whether what a skill writes is approved on arrival or waits for your review (`/settings`). */
import { useEffect, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { AutoApprove, SettingsPublic } from '../../lib/api/types/settings';
import { problemOf } from '../common/Problem';
import { Row, Section, Segmented } from './Controls';
import styles from './Settings.module.css';

const MODES: readonly { value: AutoApprove; label: string; hint: string }[] = [
  { value: 'off', label: 'Review everything', hint: 'Every new note, quiz or card waits for you to approve it.' },
  { value: 'passing', label: 'Clean drafts', hint: 'Approved on arrival when every quality check passed; flagged ones still wait for you.' },
  { value: 'all', label: 'Everything', hint: 'Approved on arrival, flagged or not. Their flags stay visible on the artifact.' },
];

export function ApprovalSection({ api = browserApi }: { api?: Pick<ApiClient, 'get' | 'patch'> }) {
  const [mode, setMode] = useState<AutoApprove | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.get<SettingsPublic>('settings').then(
      (s) => setMode(s.auto_approve),
      (error: unknown) => setStatus(problemOf(error).message),
    );
  }, [api]);

  const choose = async (next: AutoApprove) => {
    const before = mode;
    setMode(next);
    try {
      setMode((await api.patch<SettingsPublic>('settings', { auto_approve: next })).auto_approve);
      setStatus('Saved. It applies to what is written from now on; what already waits is left as it is.');
    } catch (error) {
      setMode(before);
      setStatus(`Not saved: ${problemOf(error).message}`);
    }
  };

  return (
    <Section
      id="approval"
      eyebrow="Review"
      title="Approving new material"
      hint="Approved material is what search, exports and the next pipeline steps build on. Skip the review to let a book run end to end on its own."
    >
      {mode === null ? null : (
        <Row label="Approve">
          <div className={styles.checks}>
            <Segmented label="Approve" value={mode} options={MODES} onChange={(next) => void choose(next)} />
            <p className={styles.sample}>{MODES.find((m) => m.value === mode)?.hint}</p>
          </div>
        </Row>
      )}
      <p className={styles.status} role="status">{status}</p>
    </Section>
  );
}
