/**
 * Why a meaning-based search came back empty (`index_state` on vector intents): nothing
 * is indexed yet, or the vector store (Qdrant) is not reachable. Each points at what to
 * do next; addressed and exact-phrase (lexical) searches never need the index.
 */
import type { IndexState } from '../../lib/api/types/search';
import styles from './Search.module.css';

export function IndexStateNote({ state, onLexical }: { state: Exclude<IndexState, 'ready'>; onLexical: () => void }) {
  const lexical = (
    <button type="button" className={styles.inlineAction} onClick={onLexical}>
      search the exact words instead
    </button>
  );
  if (state === 'empty') {
    return (
      <div className={styles.indexNote} role="status">
        <p className={styles.indexTitle}>Nothing is indexed for search yet.</p>
        <p>
          Search reads approved distillations once they are embedded. Approve drafts in <a href="/review">Review</a>, then
          the Index stage on the <a href="/pipeline">Pipeline</a> embeds them. Meanwhile you can {lexical}.
        </p>
      </div>
    );
  }
  return (
    <div className={styles.indexNote} role="status" data-state="unavailable">
      <p className={styles.indexTitle}>Meaning-based search is unavailable right now.</p>
      <p>
        The vector index (Qdrant) is not reachable; the API status in the footer says why. Your books are fine, and you can{' '}
        {lexical}.
      </p>
    </div>
  );
}
