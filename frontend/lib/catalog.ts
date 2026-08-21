import { VERDICTS } from './judge-contract';
import {
  parseFeedbackConfig,
  parseProblemRow,
  parseTestCaseRow,
  type Difficulty,
  type ProblemFeedbackConfig,
  type ProblemRow,
  type TestCaseRow,
} from './catalog-validation';
import { getAdminSupabaseClient, getPublicSupabaseClient } from './supabase';

export type { Difficulty, ProblemFeedbackConfig } from './catalog-validation';

export interface ProblemTestCase {
  id: number;
  case_order: number;
  input: string;
  output: string;
  explanation?: string;
  is_sample: boolean;
}

export interface Problem extends ProblemRow {
  test_cases: ProblemTestCase[];
}

export interface JudgeProblemBundle {
  problem: Problem;
  test_cases: ProblemTestCase[];
  feedback: ProblemFeedbackConfig;
}

export class CatalogUnavailableError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CatalogUnavailableError';
    this.cause = cause;
  }
}

function mapTestCase(row: TestCaseRow): ProblemTestCase {
  return {
    id: row.id,
    case_order: row.case_order,
    input: row.input_data,
    output: row.expected_output,
    explanation: row.explanation || undefined,
    is_sample: row.is_sample,
  };
}

function mapProblem(row: ProblemRow, testCases: TestCaseRow[] = []): Problem {
  return { ...row, test_cases: testCases.map(mapTestCase) };
}

export async function getProblems(): Promise<Problem[]> {
  try {
    const { data, error } = await getPublicSupabaseClient()
      .from('problems')
      .select('id, slug, display_order, title, description, difficulty, category, input_format, output_format, constraints, starter_code')
      .eq('status', 'published')
      .order('display_order');

    if (error) throw error;
    return (data || []).map((row) => mapProblem(parseProblemRow(row)));
  } catch (error) {
    throw new CatalogUnavailableError('문제 목록을 불러오지 못했습니다.', error);
  }
}

export async function getProblemById(id: number): Promise<Problem | null> {
  try {
    const client = getPublicSupabaseClient();
    const [{ data: problem, error: problemError }, { data: testCases, error: testCaseError }] = await Promise.all([
      client
        .from('problems')
        .select('id, slug, display_order, title, description, difficulty, category, input_format, output_format, constraints, starter_code')
        .eq('id', id)
        .eq('status', 'published')
        .maybeSingle(),
      client
        .from('problem_test_cases')
        .select('id, problem_id, case_order, input_data, expected_output, explanation, is_sample')
        .eq('problem_id', id)
        .eq('is_sample', true)
        .order('case_order'),
    ]);

    if (problemError) throw problemError;
    if (testCaseError) throw testCaseError;
    if (!problem) return null;
    return mapProblem(parseProblemRow(problem), (testCases || []).map(parseTestCaseRow));
  } catch (error) {
    throw new CatalogUnavailableError('문제를 불러오지 못했습니다.', error);
  }
}

export async function getJudgeProblemBundle(id: number): Promise<JudgeProblemBundle | null> {
  try {
    const client = getAdminSupabaseClient();
    const [problemResult, testCaseResult, feedbackResult] = await Promise.all([
      client
        .from('problems')
        .select('id, slug, display_order, title, description, difficulty, category, input_format, output_format, constraints, starter_code')
        .eq('id', id)
        .eq('status', 'published')
        .maybeSingle(),
      client
        .from('problem_test_cases')
        .select('id, problem_id, case_order, input_data, expected_output, explanation, is_sample')
        .eq('problem_id', id)
        .order('case_order'),
      client
        .from('problem_feedback_configs')
        .select('prompt_context, common_mistakes, fallback_hints')
        .eq('problem_id', id)
        .maybeSingle(),
    ]);

    const error = problemResult.error || testCaseResult.error || feedbackResult.error;
    if (error) throw error;
    if (!problemResult.data) return null;
    if (!feedbackResult.data || !testCaseResult.data?.length) {
      throw new Error('채점 데이터가 완전하지 않습니다.');
    }

    const testCases = testCaseResult.data.map(parseTestCaseRow);
    if (!testCases.some((testCase) => testCase.is_sample)) {
      throw new Error('공개 sample 테스트가 없습니다.');
    }
    if (!testCases.some((testCase) => !testCase.is_sample)) {
      throw new Error('숨은 테스트가 없습니다.');
    }

    return {
      problem: mapProblem(
        parseProblemRow(problemResult.data),
        testCases.filter((testCase) => testCase.is_sample),
      ),
      test_cases: testCases.map(mapTestCase),
      feedback: parseFeedbackConfig(feedbackResult.data, VERDICTS),
    };
  } catch (error) {
    throw new CatalogUnavailableError('채점 데이터를 불러오지 못했습니다.', error);
  }
}
