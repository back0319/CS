export const VERDICTS = ['AC', 'WA', 'CE', 'RE', 'TLE'] as const;

export type Verdict = (typeof VERDICTS)[number];

export const RUNNER_OUTCOMES = [
  'OK',
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'TIMED_OUT',
  'OUTPUT_LIMIT',
] as const;

export type RunnerOutcome = (typeof RUNNER_OUTCOMES)[number];

export type FailureCategory =
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'time_limit'
  | 'output_limit';

export interface RunnerResult {
  outcome: RunnerOutcome;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
}

export interface JudgeCaseResult {
  verdict: Verdict;
  executionTimeMs: number;
  failureCategory?: FailureCategory;
}

export interface JudgeResult {
  verdict: Verdict;
  executionTimeMs: number;
  failureCategory?: FailureCategory;
}

export interface FeedbackItem {
  id: number;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface PublicSubmissionResponse {
  submission_id: string;
  verdict: Verdict;
  execution_time: number;
  feedback: FeedbackItem[];
}

const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;

export function normalizeOutput(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function parseRunnerResult(value: unknown): RunnerResult {
  if (!value || typeof value !== 'object') {
    throw new Error('채점기 응답이 객체가 아닙니다.');
  }

  const candidate = value as Record<string, unknown>;
  if (!RUNNER_OUTCOMES.includes(candidate.outcome as RunnerOutcome)) {
    throw new Error('채점기 실행 결과가 올바르지 않습니다.');
  }
  if (typeof candidate.stdout !== 'string' || typeof candidate.stderr !== 'string') {
    throw new Error('채점기 출력 형식이 올바르지 않습니다.');
  }
  if (
    Buffer.byteLength(candidate.stdout, 'utf8') > MAX_CAPTURED_OUTPUT_BYTES
    || Buffer.byteLength(candidate.stderr, 'utf8') > MAX_CAPTURED_OUTPUT_BYTES
  ) {
    throw new Error('채점기 출력 한도를 초과했습니다.');
  }
  if (
    typeof candidate.execution_time !== 'number'
    || !Number.isFinite(candidate.execution_time)
    || candidate.execution_time < 0
  ) {
    throw new Error('채점기 실행 시간이 올바르지 않습니다.');
  }

  return {
    outcome: candidate.outcome as RunnerOutcome,
    stdout: candidate.stdout,
    stderr: candidate.stderr,
    executionTimeMs: candidate.execution_time,
  };
}

export function decideCaseVerdict(
  execution: RunnerResult,
  expectedOutput: string,
): JudgeCaseResult {
  const base = { executionTimeMs: execution.executionTimeMs };

  switch (execution.outcome) {
    case 'COMPILE_ERROR':
      return { ...base, verdict: 'CE', failureCategory: 'compile_error' };
    case 'RUNTIME_ERROR':
      return { ...base, verdict: 'RE', failureCategory: 'runtime_error' };
    case 'TIMED_OUT':
      return { ...base, verdict: 'TLE', failureCategory: 'time_limit' };
    case 'OUTPUT_LIMIT':
      return { ...base, verdict: 'RE', failureCategory: 'output_limit' };
    case 'OK':
      if (normalizeOutput(execution.stdout) === normalizeOutput(expectedOutput)) {
        return { ...base, verdict: 'AC' };
      }
      return { ...base, verdict: 'WA', failureCategory: 'wrong_answer' };
  }
}

export function summarizeJudgeResults(results: JudgeCaseResult[]): JudgeResult {
  if (results.length === 0) {
    throw new Error('채점할 테스트 케이스가 없습니다.');
  }

  const failure = results.find((result) => result.verdict !== 'AC');
  return {
    verdict: failure?.verdict ?? 'AC',
    executionTimeMs: Math.round(
      results.reduce((total, result) => total + result.executionTimeMs, 0) * 100,
    ) / 100,
    failureCategory: failure?.failureCategory,
  };
}

export function toPublicSubmissionResponse(
  submissionId: string,
  result: JudgeResult,
  feedback: FeedbackItem[],
): PublicSubmissionResponse {
  return {
    submission_id: submissionId,
    verdict: result.verdict,
    execution_time: result.executionTimeMs,
    feedback,
  };
}
