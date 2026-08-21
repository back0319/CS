import { useEffect, useState } from 'react';
import { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import Layout from '../../components/Layout';
import CodeRunner from '../../components/CodeRunner';
import Feedback from '../../components/Feedback';
import { getProblemById } from '../../lib/catalog';
import { useExecutionAttempt } from '../../lib/use-execution-attempt';

// Monaco Editor를 동적으로 로드 (SSR 이슈 방지)
const MonacoEditor = dynamic(() => import('../../components/MonacoEditor'), {
  ssr: false,
  loading: () => (
    <div className="h-96 bg-gray-100 rounded-lg flex items-center justify-center">
      <div className="text-gray-500">에디터 로딩 중...</div>
    </div>
  ),
});

// 시각화 모달 컴포넌트를 동적으로 로드
const VisualizationModal = dynamic(() => import('../../components/VisualizationModal'), {
  ssr: false,
  loading: () => null,
});

interface TestCase {
  input: string;
  output: string;
  explanation?: string;
}

interface Problem {
  id: number;
  title: string;
  description: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  category: string;
  input_format: string;
  output_format: string;
  constraints: string[];
  starter_code: string;
  test_cases?: TestCase[];
  input?: string;
  output?: string;
  input_examples?: string[];
  output_examples?: string[];
  example_explanation?: string;
}

interface ProblemSolvePageProps {
  problem: Problem | null;
  loadError: string | null;
}

const CODE_TEMPLATE = `def solution():
    # 여기에 코드를 작성하세요
    pass

# 예시 실행
print(solution())`;

const getDefaultInput = (problem: Problem | null): string => {
  if (!problem) return '';
  return problem.test_cases?.[0]?.input
    ?? problem.input_examples?.[0]
    ?? problem.input
    ?? '';
};

export default function ProblemSolvePage({ problem, loadError }: ProblemSolvePageProps) {
  const router = useRouter();
  const defaultInput = getDefaultInput(problem);
  const [code, setCode] = useState(problem?.starter_code || CODE_TEMPLATE);
  const execution = useExecutionAttempt();
  const resetExecution = execution.reset;
  
  // 시각화 모달 관련 state
  const [isVisualizationModalOpen, setIsVisualizationModalOpen] = useState(false);
  const [inputForVisualization, setInputForVisualization] = useState(defaultInput);

  useEffect(() => {
    setCode(problem?.starter_code || CODE_TEMPLATE);
    setInputForVisualization(defaultInput);
    resetExecution();
  }, [defaultInput, problem?.id, problem?.starter_code, resetExecution]);

  const handleSubmit = async () => {
    if (!code.trim()) {
      alert('코드를 입력해주세요.');
      return;
    }

    if (problem) await execution.submit(problem.id, code);
  };

  const handleRun = async () => {
    if (!code.trim()) {
      alert('코드를 입력해주세요.');
      return;
    }

    await execution.run(code, inputForVisualization);
  };

  if (!problem) {
    return (
      <Layout>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              {loadError ? '문제를 불러오지 못했습니다' : '문제를 찾을 수 없습니다'}
            </h1>
            {loadError && <p className="mb-6 text-gray-600">{loadError}</p>}
            <button 
              onClick={() => router.push('/problems')}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700"
            >
              문제 목록으로 돌아가기
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => router.push('/problems')}
              className="flex items-center text-indigo-600 hover:text-indigo-800 mb-4"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              문제 목록으로 돌아가기
            </button>
            
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">
                  {problem.id}. {problem.title}
                </h1>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* 문제 설명 패널 */}
            <div className="lg:col-span-3 bg-white rounded-lg shadow-lg p-6 min-h-[36rem]">
              <div className="space-y-6">
                {/* 헤더와 시각화 버튼 */}
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">문제 설명</h3>
                  <button
                    onClick={() => setIsVisualizationModalOpen(true)}
                    className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors flex items-center space-x-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    <span>시각화</span>
                  </button>
                </div>

                {/* 문제 설명 */}
                <div>
                  <div className="text-gray-700 whitespace-pre-line">
                    {problem.description}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h4 className="mb-2 font-semibold text-gray-900">입력 형식</h4>
                    <p className="whitespace-pre-line text-sm leading-6 text-gray-700">{problem.input_format}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h4 className="mb-2 font-semibold text-gray-900">출력 형식</h4>
                    <p className="whitespace-pre-line text-sm leading-6 text-gray-700">{problem.output_format}</p>
                  </div>
                </div>

                {problem.constraints.length > 0 && (
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h4 className="mb-2 font-semibold text-gray-900">제한사항</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-gray-700">
                      {problem.constraints.map((constraint) => <li key={constraint}>{constraint}</li>)}
                    </ul>
                  </div>
                )}

                {/* 입출력 예시 */}
                <div className="space-y-4">
                  <h4 className="text-lg font-semibold text-gray-900">입출력 예시</h4>
                  
                  {problem.test_cases && problem.test_cases.length > 0 ? (
                    /* test_cases 배열 사용 (새로운 방식) - 최대 2개만 표시 */
                    <div className="space-y-4">
                      {problem.test_cases.slice(0, 2).map((testCase, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg overflow-hidden">
                          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                            <span className="font-semibold text-gray-700">예시 {index + 1}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                            <div className="p-4">
                              <div className="text-sm font-medium text-gray-600 mb-2">입력</div>
                              <pre className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                                {testCase.input}
                              </pre>
                            </div>
                            <div className="p-4">
                              <div className="text-sm font-medium text-gray-600 mb-2">출력</div>
                              <pre className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                                {testCase.output}
                              </pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : problem.input_examples && problem.output_examples && 
                   problem.input_examples.length > 0 && problem.output_examples.length > 0 ? (
                    /* input_examples 배열이 있을 때 (이전 방식) */
                    <div className="space-y-4">
                      {problem.input_examples.map((input, index) => (
                        <div key={index} className="border border-gray-200 rounded-lg overflow-hidden">
                          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                            <span className="font-semibold text-gray-700">예시 {index + 1}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                            <div className="p-4">
                              <div className="text-sm font-medium text-gray-600 mb-2">입력</div>
                              <pre className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                                {input}
                              </pre>
                            </div>
                            <div className="p-4">
                              <div className="text-sm font-medium text-gray-600 mb-2">출력</div>
                              <pre className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                                {problem.output_examples?.[index] || ''}
                              </pre>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : problem.input && problem.output ? (
                    /* 데이터베이스의 input/output 컬럼 사용 (레거시) */
                    <div className="space-y-4">
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                          <span className="font-semibold text-gray-700">예시</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                          <div className="p-4">
                            <div className="text-sm font-medium text-gray-600 mb-2">입력</div>
                            <pre className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                              {problem.input}
                            </pre>
                          </div>
                          <div className="p-4">
                            <div className="text-sm font-medium text-gray-600 mb-2">출력</div>
                            <pre className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                              {problem.output}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 입출력 데이터가 없는 경우 */
                    <div className="text-center text-gray-500 py-8">
                      입출력 예시가 준비되지 않았습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 코드 에디터 패널 */}
            <div className="lg:col-span-2 bg-white rounded-lg shadow-lg p-6 min-h-[36rem]">
              <div className="space-y-4">
                {/* 제목 */}
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">코드 에디터 (Python)</h3>
                </div>

                {/* Monaco Editor */}
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  <MonacoEditor
                    value={code}
                    onChange={(value) => {
                      setCode(value || '');
                      execution.reset();
                    }}
                    language="python"
                    theme="vs-dark"
                    height="500px"
                    fontSize={14}
                    minimap={false}
                    wordWrap="on"
                  />
                </div>

                {/* 입력 데이터 설정 */}
                <div className="border border-gray-200 rounded-lg p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    입력 데이터 (각 줄마다 한 입력값)
                  </label>
                  <textarea
                    value={inputForVisualization}
                    onChange={(e) => {
                      setInputForVisualization(e.target.value);
                      execution.reset();
                    }}
                    placeholder="예: 5"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                    rows={2}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    input()을 사용하는 코드의 경우, 여기에 입력값을 작성하세요.
                  </p>
                </div>

                {/* 실행 버튼들 */}
                {execution.error && (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                    {execution.error}
                  </p>
                )}
                <div className="flex space-x-3">
                  <button
                    onClick={handleRun}
                    disabled={execution.isBusy}
                    className="flex-1 bg-gray-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {execution.isRunning ? '실행 중...' : '실행'}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={execution.isBusy}
                    className="flex-1 bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {execution.isSubmitting ? '제출 중...' : '제출'}
                  </button>
                </div>
              </div>
            </div>

            {/* 실행 결과패널 */}
            <div className="lg:col-span-2 bg-white rounded-lg shadow-lg overflow-hidden">
              <CodeRunner
                isRunning={execution.isRunning}
                result={execution.runResult}
              />
            </div>

            {/* 피드백 패널 */}
            <div className="lg:col-span-3 bg-white rounded-lg shadow-lg overflow-hidden">
              <Feedback
                aiFeedback={execution.submissionResult?.feedback}
                isAnalyzing={execution.isSubmitting}
                submissionVerdict={execution.submissionResult?.verdict}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 시각화 모달 */}
      <VisualizationModal
        isOpen={isVisualizationModalOpen}
        onClose={() => setIsVisualizationModalOpen(false)}
        code={code}
        inputData={inputForVisualization}
      />
    </Layout>
  );
}

export const getServerSideProps: GetServerSideProps<ProblemSolvePageProps> = async ({ params, res }) => {
  const id = Number(params?.id);
  if (!Number.isInteger(id)) return { notFound: true };

  try {
    const problem = await getProblemById(id);
    if (!problem) return { notFound: true };
    return { props: { problem, loadError: null } };
  } catch (error) {
    console.error('Problem detail load error:', error instanceof Error ? error.message : String(error));
    res.statusCode = 503;
    return {
      props: {
        problem: null,
        loadError: '문제 데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      },
    };
  }
};
