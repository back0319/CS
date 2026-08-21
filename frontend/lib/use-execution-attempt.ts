import { useCallback, useEffect, useReducer, useRef } from 'react';
import { attemptReducer, INITIAL_ATTEMPT_STATE } from './attempt-state';
import { hashCode, runCode, submitCode } from './execution-client';

export function useExecutionAttempt() {
  const [state, dispatch] = useReducer(attemptReducer, INITIAL_ATTEMPT_STATE);
  const controllerRef = useRef<AbortController | null>(null);

  const abortCurrent = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    abortCurrent();
    dispatch({ type: 'reset' });
  }, [abortCurrent]);

  useEffect(() => abortCurrent, [abortCurrent]);

  const run = useCallback(async (code: string, input: string) => {
    abortCurrent();
    const controller = new AbortController();
    controllerRef.current = controller;
    const attemptId = crypto.randomUUID();
    const codeHash = await hashCode(code);
    if (controller.signal.aborted) return;
    dispatch({ type: 'start', attemptId, operation: 'run', codeHash });
    try {
      const result = await runCode(code, input, controller.signal);
      dispatch({ type: 'run_succeeded', attemptId, result });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({
        type: 'failed',
        attemptId,
        message: error instanceof Error ? error.message : '코드 실행에 실패했습니다.',
      });
    }
  }, [abortCurrent]);

  const submit = useCallback(async (problemId: number, code: string) => {
    abortCurrent();
    const controller = new AbortController();
    controllerRef.current = controller;
    const attemptId = crypto.randomUUID();
    const codeHash = await hashCode(code);
    if (controller.signal.aborted) return;
    dispatch({ type: 'start', attemptId, operation: 'submit', codeHash });
    try {
      const result = await submitCode(problemId, code, attemptId, codeHash, controller.signal);
      dispatch({ type: 'submit_succeeded', attemptId, result });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({
        type: 'failed',
        attemptId,
        message: error instanceof Error ? error.message : '제출에 실패했습니다.',
      });
    }
  }, [abortCurrent]);

  return {
    ...state,
    isRunning: state.activeOperation === 'run',
    isSubmitting: state.activeOperation === 'submit',
    isBusy: state.activeOperation !== null,
    run,
    submit,
    reset,
  };
}
