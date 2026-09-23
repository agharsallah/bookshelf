/**
 * `useAnswerStream` — ask a question and follow `POST /search/answer` as it streams
 * (status → hits → answer | error). One question at a time: asking again or calling
 * `cancel` aborts the open stream.
 *
 *   const { state, ask, cancel } = useAnswerStream();
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { problemOf } from '../../components/document/Problem';
import { answerReducer, idleAnswer, streamAnswer, type AnswerState } from '../../components/search/answer';
import type { SearchRequest } from '../api/types/search';

export interface UseAnswerStream {
  state: AnswerState;
  ask: (request: SearchRequest) => void;
  cancel: () => void;
  reset: () => void;
}

export function useAnswerStream(fetchImpl?: typeof fetch): UseAnswerStream {
  const [state, dispatch] = useReducer(answerReducer, idleAnswer);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (!controller.current) return;
    controller.current.abort();
    controller.current = null;
    dispatch({ type: 'cancel' });
  }, []);

  const ask = useCallback(
    (request: SearchRequest) => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      dispatch({ type: 'start', question: request.query });
      streamAnswer({
        request,
        signal: mine.signal,
        fetch: fetchImpl,
        onEvent: (event, requestId) => {
          if (!mine.signal.aborted) dispatch({ type: 'event', event, requestId });
        },
      })
        .then(() => {
          // Ended without `answer` or `error`: the connection dropped mid-way.
          if (!mine.signal.aborted) {
            dispatch({ type: 'fail', error: { code: 'incomplete', message: 'The answer stream ended early.', requestId: null } });
          }
        })
        .catch((error: unknown) => {
          if (mine.signal.aborted) return;
          const problem = problemOf(error);
          dispatch({ type: 'fail', error: { code: problem.code, message: problem.message, requestId: problem.requestId } });
        })
        .finally(() => {
          if (controller.current === mine) controller.current = null;
        });
    },
    [fetchImpl],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: 'reset' });
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, ask, cancel, reset };
}
