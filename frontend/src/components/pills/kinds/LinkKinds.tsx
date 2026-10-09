/**
 * The kinds about how ideas stand: a claim with its kind, strength and the edges that
 * back or dispute it, and a connection drawn as two passages side by side, each citing
 * its own book.
 */
import type { ClaimKind, ClaimStrength, ConnectionRelation } from '../../../lib/pills/types';
import { Spans } from '../../blocks/Spans';
import { readerHref } from '../../search/links';
import { PillCites } from '../PillCites';
import type { KindProps } from './context';
import styles from './Kinds.module.css';

const CLAIM_KINDS: Record<ClaimKind, string> = {
  method: 'Method',
  result: 'Result',
  theory: 'Theory',
  dataset: 'Dataset',
  benchmark: 'Benchmark',
  position: 'Position',
};

const STRENGTHS: Record<ClaimStrength, string> = { measured: 'Measured', argued: 'Argued', speculated: 'Speculated' };

const RELATIONS: Record<ConnectionRelation, string> = {
  echoes: 'echoes',
  supports: 'supports',
  contradicts: 'contradicts',
  extends: 'extends',
  example_of: 'is an example of',
  same_as: 'is the same idea as',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ClaimPill({ pill }: KindProps<'claim'>) {
  const { text, claim_kind, strength, support } = pill.body;
  const counts = [
    support.supports ? `${plural(support.supports, 'source')} support it` : null,
    support.contradicts ? `${plural(support.contradicts, 'source')} dispute it` : null,
    support.extends ? `${plural(support.extends, 'source')} build on it` : null,
  ].filter(Boolean);
  return (
    <div className={styles.claim}>
      <p className={styles.badges}>
        <span className={styles.badge}>{CLAIM_KINDS[claim_kind] ?? claim_kind}</span>
        <span className={styles.badge} data-strength={strength}>
          {STRENGTHS[strength] ?? strength}
        </span>
      </p>
      <p className={styles.lead}>{text}</p>
      {counts.length > 0 ? <p className={styles.note}>{counts.join(' · ')}</p> : null}
    </div>
  );
}

export function ConnectionPill({ pill }: KindProps<'connection'>) {
  const { relation, concept, sides } = pill.body;
  const [left, right] = sides;
  return (
    <div className={styles.connection}>
      {concept ? <p className={styles.concept}>{concept}</p> : null}
      <div className={styles.sides}>
        {[left, right].map((side, index) => (
          <section key={index} className={styles.side} aria-label={side.document.title}>
            <a className={styles.sideTitle} href={readerHref(side.document.slug, side.anchor)}>
              {side.document.title}
            </a>
            <PillCites pill={pill} slug={side.document.slug}>
              <p>
                <Spans spans={side.spans} />
              </p>
            </PillCites>
          </section>
        ))}
      </div>
      <p className={styles.relation}>
        {left.document.title} {RELATIONS[relation] ?? relation} {right.document.title}
      </p>
    </div>
  );
}
