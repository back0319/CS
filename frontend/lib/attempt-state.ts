import type { PublicSubmissionResponse } from './judge-contract';

export interface RunResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime?: number;
}

export interface AttemptState {
  activeAttemptId: string | null;
  activeOperation: 'run' | 'submit' | null;
  codeHash: string | null;
  runResult: RunResult | null;
  submissionResult: PublicSubmissionResponse | null;
  error: string | null;
}

export type AttemptAction =
  | { type: 'start'; attemptId: string; operation: 'run' | 'submit'; codeHash: string }
  | { type: 'run_succeeded'; attemptId: string; result: RunResult }
  | { type: 'submit_succeeded'; attemptId: string; result: PublicSubmissionResponse }
  | { type: 'failed'; attemptId: string; message: string }
  | { type: 'reset' };

export const INITIAL_ATTEMPT_STATE: AttemptState = {
  activeAttemptId: null,
  activeOperation: null,
  codeHash: null,
  runResult: null,
  submissionResult: null,
  error: null,
};

export function attemptReducer(state: AttemptState, action: AttemptAction): AttemptState {
  switch (action.type) {
    case 'start':
      return {
        activeAttemptId: action.attemptId,
        activeOperation: action.operation,
        codeHash: action.codeHash,
        runResult: null,
        submissionResult: null,
        error: null,
      };
    case 'run_succeeded':
      if (action.attemptId !== state.activeAttemptId) return state;
      return { ...state, activeOperation: null, runResult: action.result };
    case 'submit_succeeded':
      if (action.attemptId !== state.activeAttemptId) return state;
      return { ...state, activeOperation: null, submissionResult: action.result };
    case 'failed':
      if (action.attemptId !== state.activeAttemptId) return state;
      return { ...state, activeOperation: null, error: action.message };
    case 'reset':
      return INITIAL_ATTEMPT_STATE;
  }
}
