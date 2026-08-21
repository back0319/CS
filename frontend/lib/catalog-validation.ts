import type { Verdict } from './judge-contract';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface ProblemRow {
  id: number;
  slug: string;
  display_order: number;
  title: string;
  description: string;
  difficulty: Difficulty;
  category: string;
  input_format: string;
  output_format: string;
  constraints: string[];
  starter_code: string;
}

export interface TestCaseRow {
  id: number;
  problem_id: number;
  case_order: number;
  input_data: string;
  expected_output: string;
  explanation: string | null;
  is_sample: boolean;
}

export interface ProblemFeedbackConfig {
  prompt_context: string;
  common_mistakes: string[];
  fallback_hints: Partial<Record<Verdict, string>>;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function asSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) {
    throw new Error(`${label}가 JavaScript 안전 정수 범위를 벗어났습니다.`);
  }
  return parsed;
}

export function parseProblemRow(value: unknown): ProblemRow {
  const row = asRecord(value, '문제');
  const difficulty = asString(row.difficulty, '난이도');
  if (!['Easy', 'Medium', 'Hard'].includes(difficulty)) {
    throw new Error('난이도 값이 올바르지 않습니다.');
  }
  if (!Array.isArray(row.constraints) || !row.constraints.every((item) => typeof item === 'string')) {
    throw new Error('제한사항 형식이 올바르지 않습니다.');
  }
  return {
    id: asSafeInteger(row.id, '문제 ID'),
    slug: asString(row.slug, '문제 slug'),
    display_order: asSafeInteger(row.display_order, '표시 순서'),
    title: asString(row.title, '문제 제목'),
    description: asString(row.description, '문제 설명'),
    difficulty: difficulty as Difficulty,
    category: asString(row.category, '문제 분류'),
    input_format: asString(row.input_format, '입력 형식'),
    output_format: asString(row.output_format, '출력 형식'),
    constraints: row.constraints,
    starter_code: asString(row.starter_code, '초기 코드'),
  };
}

export function parseTestCaseRow(value: unknown): TestCaseRow {
  const row = asRecord(value, '테스트 케이스');
  if (typeof row.is_sample !== 'boolean') {
    throw new Error('테스트 공개 여부 형식이 올바르지 않습니다.');
  }
  if (row.explanation !== null && row.explanation !== undefined && typeof row.explanation !== 'string') {
    throw new Error('테스트 설명 형식이 올바르지 않습니다.');
  }
  return {
    id: asSafeInteger(row.id, '테스트 ID'),
    problem_id: asSafeInteger(row.problem_id, '테스트 문제 ID'),
    case_order: asSafeInteger(row.case_order, '테스트 순서'),
    input_data: asString(row.input_data, '테스트 입력'),
    expected_output: asString(row.expected_output, '테스트 기대 출력'),
    explanation: row.explanation || null,
    is_sample: row.is_sample,
  };
}

export function parseFeedbackConfig(
  value: unknown,
  allowedVerdicts: readonly Verdict[],
): ProblemFeedbackConfig {
  const row = asRecord(value, '피드백 설정');
  if (
    !Array.isArray(row.common_mistakes)
    || !row.common_mistakes.every((item) => typeof item === 'string')
  ) {
    throw new Error('흔한 실수 설정 형식이 올바르지 않습니다.');
  }
  const rawFallbacks = asRecord(row.fallback_hints, 'fallback 힌트');
  const fallback_hints: Partial<Record<Verdict, string>> = {};
  for (const [key, hint] of Object.entries(rawFallbacks)) {
    if (!allowedVerdicts.includes(key as Verdict) || typeof hint !== 'string') {
      throw new Error('fallback 힌트 형식이 올바르지 않습니다.');
    }
    fallback_hints[key as Verdict] = hint;
  }
  return {
    prompt_context: asString(row.prompt_context, '힌트 확인 관점'),
    common_mistakes: row.common_mistakes,
    fallback_hints,
  };
}
