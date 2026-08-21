import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node's type-stripping runner requires the explicit .ts extension.
import { attemptReducer, INITIAL_ATTEMPT_STATE } from './attempt-state.ts';

test('새 attempt는 이전 실행·제출 결과를 즉시 비운다', () => {
  const previous = {
    ...INITIAL_ATTEMPT_STATE,
    runResult: { success: true, output: 'old' },
    submissionResult: {
      submission_id: 'old',
      verdict: 'AC' as const,
      execution_time: 1,
      feedback: [],
    },
  };
  const next = attemptReducer(previous, {
    type: 'start', attemptId: 'new', operation: 'submit', codeHash: 'hash',
  });
  assert.equal(next.runResult, null);
  assert.equal(next.submissionResult, null);
  assert.equal(next.activeAttemptId, 'new');
});

test('늦게 도착한 이전 attempt 응답은 최신 상태를 덮지 않는다', () => {
  const current = attemptReducer(INITIAL_ATTEMPT_STATE, {
    type: 'start', attemptId: 'new', operation: 'submit', codeHash: 'new-hash',
  });
  const afterLateResponse = attemptReducer(current, {
    type: 'submit_succeeded',
    attemptId: 'old',
    result: { submission_id: 'old', verdict: 'WA', execution_time: 1, feedback: [] },
  });
  assert.strictEqual(afterLateResponse, current);
});

test('최신 attempt 응답만 완료 상태에 반영한다', () => {
  const current = attemptReducer(INITIAL_ATTEMPT_STATE, {
    type: 'start', attemptId: 'new', operation: 'run', codeHash: 'new-hash',
  });
  const completed = attemptReducer(current, {
    type: 'run_succeeded', attemptId: 'new', result: { success: true, output: 'ok' },
  });
  assert.equal(completed.activeOperation, null);
  assert.deepEqual(completed.runResult, { success: true, output: 'ok' });
});
