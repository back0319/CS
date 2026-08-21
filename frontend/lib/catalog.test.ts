import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node's type-stripping runner requires the explicit .ts extension.
import { parseFeedbackConfig, parseProblemRow, parseTestCaseRow } from './catalog-validation.ts';

const problem = {
  id: 1,
  slug: 'sum',
  display_order: 1,
  title: '합',
  description: '두 수의 합',
  difficulty: 'Easy',
  category: '기초',
  input_format: '두 정수',
  output_format: '합',
  constraints: ['정수'],
  starter_code: '',
};

test('문제 JSONB와 bigint를 런타임에 검증한다', () => {
  assert.equal(parseProblemRow({ ...problem, id: '9007199254740991' }).id, Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseProblemRow({ ...problem, id: '9007199254740992' }), /안전 정수/);
  assert.throws(() => parseProblemRow({ ...problem, constraints: null }), /제한사항/);
  assert.throws(() => parseProblemRow({ ...problem, constraints: [1] }), /제한사항/);
});

test('테스트 데이터의 null과 boolean 경계를 검증한다', () => {
  const testCase = {
    id: 1, problem_id: 1, case_order: 1, input_data: '', expected_output: '0',
    explanation: null, is_sample: true,
  };
  assert.equal(parseTestCaseRow(testCase).explanation, null);
  assert.throws(() => parseTestCaseRow({ ...testCase, is_sample: 'true' }), /공개 여부/);
});

test('피드백 설정은 문자열 배열과 허용 verdict 힌트만 받는다', () => {
  assert.deepEqual(parseFeedbackConfig({
    prompt_context: '조건을 확인',
    common_mistakes: ['경계값'],
    fallback_hints: { WA: '조건을 확인하세요.' },
  }, ['AC', 'WA', 'CE', 'RE', 'TLE']).fallback_hints, { WA: '조건을 확인하세요.' });
  assert.throws(() => parseFeedbackConfig({
    prompt_context: '', common_mistakes: {}, fallback_hints: {},
  }, ['AC', 'WA', 'CE', 'RE', 'TLE']), /흔한 실수/);
  assert.throws(() => parseFeedbackConfig({
    prompt_context: '', common_mistakes: [], fallback_hints: { HACK: 'x' },
  }, ['AC', 'WA', 'CE', 'RE', 'TLE']), /fallback/);
});
