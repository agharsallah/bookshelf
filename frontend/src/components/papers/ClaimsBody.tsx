/**
 * The claims tab as one island: each section of the paper with the claims resting on it,
 * like a lab notebook — the key in the margin, the claim in the reading face, its kind
 * and strength, the passages it cites (opening in place), and how the shelf bears on it.
 * A draft's claims have no rows yet, so no relations: the note above says why.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { relateClaims } from '../../lib/papers/claims-api';
import { CiteProvider } from '../blocks/CiteContext';
import { CiteMarks } from '../blocks/CiteChip';
import { problemOf } from '../common/Problem';
import type { PassageUnit } from '../guide/passage';
import { ClaimBadge } from './ClaimBadge';
import { ClaimRelations } from './ClaimRelations';
import type { ClaimGroup, ClaimView } from './claims';
import { useCitedPassages } from './useCitedPassages';
import styles from './Claims.module.css';

export interface ClaimsBodyProps {
  slug: string;
  documentId: string;
  groups: ClaimGroup[];
  units: PassageUnit[];
}

function Claim({ claim, documentId, onCite }: { claim: ClaimView; documentId: string; onCite: (anchor: string) => void }) {
  return (
    <li className={styles.claim} data-strength={claim.strength} id={`claim-${claim.key}`}>
      <span className={styles.marginKey} aria-hidden="true">
        {claim.key}
      </span>
      <div className={styles.claimBody}>
        <ClaimBadge claimKey={claim.key} kind={claim.kind} strength={claim.strength} />
        <p className={styles.claimText}>
          {claim.text}
          <CiteMarks anchors={claim.evidence} />
        </p>
        {claim.id && claim.relations ? <ClaimRelations claimId={claim.id} counts={claim.relations} documentId={documentId} onCite={onCite} /> : null}
      </div>
    </li>
  );
}

export function ClaimsBody({ slug, documentId, groups, units }: ClaimsBodyProps) {
  const { cite, overlays } = useCitedPassages(slug, units, 'From the claims');
  return (
    <CiteProvider value={cite}>
      <div className={styles.groups}>
        {groups.map((group) => (
          <section key={group.unit ?? 'abstract'} className={styles.group} aria-labelledby={`claims-${group.unit ?? 'abstract'}`}>
            <h2 id={`claims-${group.unit ?? 'abstract'}`}>
              {group.heading}
              <span className={styles.groupCount}>{group.claims.length === 1 ? '1 claim' : `${group.claims.length} claims`}</span>
            </h2>
            <ol className={styles.claims}>
              {group.claims.map((claim) => (
                <Claim key={claim.key} claim={claim} documentId={documentId} onCite={cite.onCite} />
              ))}
            </ol>
          </section>
        ))}
        {overlays}
      </div>
    </CiteProvider>
  );
}

/** "Find relations": queue the cross-paper pass for this paper (`POST /papers/claims/relate`). */
export function FindRelations({ slug, api = browserApi }: { slug: string; api?: Pick<ApiClient, 'post' | 'patch'> }) {
  const [state, setState] = useState<{ phase: 'idle' | 'sending' | 'queued' | 'failed'; text?: string }>({ phase: 'idle' });
  const run = async () => {
    setState({ phase: 'sending' });
    try {
      const { jobs } = await relateClaims(api, slug);
      setState({
        phase: 'queued',
        text: jobs.length
          ? 'Comparing these claims with the rest of your shelf. New relations appear here as proposals once the job is done.'
          : 'Nothing to compare yet: no other paper on your shelf has approved claims.',
      });
    } catch (problem) {
      setState({ phase: 'failed', text: problemOf(problem).message });
    }
  };
  return (
    <div className={styles.find}>
      <button type="button" className="btn" disabled={state.phase === 'sending' || state.phase === 'queued'} onClick={() => void run()}>
        Find relations on your shelf
      </button>
      {state.text ? (
        <span className={state.phase === 'failed' ? styles.error : styles.findStatus} aria-live="polite">
          {state.phase === 'failed' ? `Could not queue it: ${state.text}` : state.text}
        </span>
      ) : null}
    </div>
  );
}

export default ClaimsBody;
