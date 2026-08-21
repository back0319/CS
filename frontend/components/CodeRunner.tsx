import React, { useState } from 'react';

interface CodeRunnerProps {
  isRunning: boolean;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
    executionTime?: number;
    memoryUsage?: number;
  } | null;
}

const CodeRunner: React.FC<CodeRunnerProps> = ({ isRunning, result }) => {
  const [showDetails, setShowDetails] = useState(false);

  const formatExecutionTime = (time?: number) => {
    if (!time) return 'N/A';
    if (time < 1000) return `${time}ms`;
    return `${(time / 1000).toFixed(2)}s`;
  };

  const formatMemoryUsage = (memory?: number) => {
    if (!memory) return 'N/A';
    if (memory < 1024) return `${memory}B`;
    if (memory < 1024 * 1024) return `${(memory / 1024).toFixed(2)}KB`;
    return `${(memory / (1024 * 1024)).toFixed(2)}MB`;
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* 실행 결과 헤더 */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-900">실행 결과</h3>
          {result && (
            <div className="flex items-center space-x-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                result.success 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-red-100 text-red-800'
              }`}>
                {result.success ? '성공' : '실패'}
              </span>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                {showDetails ? '간단히 보기' : '자세히 보기'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 실행 중 상태 */}
      {isRunning && (
        <div className="px-4 py-8 text-center">
          <div className="inline-flex items-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-gray-600">코드 실행 중...</span>
          </div>
        </div>
      )}

      {/* 실행 결과 표시 */}
      {!isRunning && result && (
        <div className="p-4">
          {/* 기본 결과 */}
          <div className="space-y-3">
            {result.output && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">출력</h4>
                <pre className="bg-gray-50 p-3 rounded-md text-sm font-mono text-gray-900 whitespace-pre-wrap overflow-x-auto">
                  {result.output}
                </pre>
              </div>
            )}

            {result.error && (
              <div>
                <h4 className="text-sm font-medium text-red-700 mb-2">오류</h4>
                <pre className="bg-red-50 p-3 rounded-md text-sm font-mono text-red-900 whitespace-pre-wrap overflow-x-auto">
                  {result.error}
                </pre>
              </div>
            )}

            {/* 상세 정보 */}
            {showDetails && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">실행 정보</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-gray-50 p-3 rounded-md">
                    <span className="font-medium text-gray-600">실행 시간:</span>
                    <span className="ml-2 text-gray-900">{formatExecutionTime(result.executionTime)}</span>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-md">
                    <span className="font-medium text-gray-600">메모리 사용량:</span>
                    <span className="ml-2 text-gray-900">{formatMemoryUsage(result.memoryUsage)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 결과가 없을 때 */}
      {!isRunning && !result && (
        <div className="px-4 py-8 text-center text-gray-500">
          코드를 실행하면 결과가 여기에 표시됩니다.
        </div>
      )}
    </div>
  );
};

export default CodeRunner;
