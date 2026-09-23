/**
 * A failed request, said plainly: what went wrong, what to try, and the request id
 * to find it in the backend logs. Renders statically from frontmatter or inside islands.
 */
import { ApiError } from '../../lib/api/errors';
import styles from './Problem.module.css';

export interface ProblemInfo {
  message: string;
  requestId: string | null;
  code: string;
  status: number;
}

/** Plain data for any thrown value (serialisable, so it can cross into an island). */
export function problemOf(error: unknown): ProblemInfo {
  if (error instanceof ApiError) {
    return { message: error.message, requestId: error.requestId, code: error.code, status: error.status };
  }
  return {
    message: error instanceof Error ? error.message : 'Something went wrong.',
    requestId: null,
    code: 'unknown',
    status: 0,
  };
}

const UNREACHABLE = new Set(['upstream_unavailable', 'network_error']);

export interface ProblemProps {
  title: string;
  problem: ProblemInfo;
  /** Compact inline variant for forms and rows. */
  inline?: boolean;
}

export function Problem({ title, problem, inline = false }: ProblemProps) {
  const hint = UNREACHABLE.has(problem.code)
    ? 'Start the backend (cd backend && uv run fastapi dev app/main.py) and reload.'
    : null;
  return (
    <div className={inline ? `${styles.problem} ${styles.inline}` : styles.problem} role="alert">
      <p className={styles.title}>{title}</p>
      <p className={styles.message}>{problem.message}</p>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {problem.requestId ? (
        <p className={styles.request}>
          Request <code>{problem.requestId}</code>
        </p>
      ) : null}
    </div>
  );
}

export default Problem;
