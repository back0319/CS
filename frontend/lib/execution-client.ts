import { VERDICTS, type PublicSubmissionResponse } from './judge-contract';
import type { RunResult } from './attempt-state';

async function requestJson<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.message === 'string' ? payload.message : '요청을 처리하지 못했습니다.');
  }
  return payload as T;
}

export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runCode(
  code: string,
  input: string,
  signal: AbortSignal,
): Promise<RunResult> {
  const result = await requestJson<{
    success: boolean;
    output?: string;
    error?: string;
    execution_time?: number;
  }>('/api/run', { code, language: 'python', input_data: input }, signal);
  return {
    success: result.success === true,
    output: result.output || '',
    error: result.error || '',
    executionTime: result.execution_time || 0,
  };
}

export async function submitCode(
  problemId: number,
  code: string,
  attemptId: string,
  codeHash: string,
  signal: AbortSignal,
): Promise<PublicSubmissionResponse> {
  const result = await requestJson<PublicSubmissionResponse>('/api/submit', {
    problem_id: problemId,
    code,
    language: 'python',
    attempt_id: attemptId,
    code_hash: codeHash,
  }, signal);
  if (
    result.submission_id !== attemptId
    || !VERDICTS.includes(result.verdict)
    || typeof result.execution_time !== 'number'
    || !Array.isArray(result.feedback)
  ) {
    throw new Error('채점 응답 형식이 올바르지 않습니다.');
  }
  return result;
}
