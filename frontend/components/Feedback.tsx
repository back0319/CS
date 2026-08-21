import React from 'react';

interface FeedbackItem {
  id: number;
  type: string;
  title: string;
  message: string;
  code_suggestion?: string;
  severity: 'info' | 'warning' | 'error';
}

interface FeedbackProps {
  aiFeedback?: FeedbackItem[];
  isAnalyzing?: boolean;
  submissionVerdict?: string;
}

const Feedback: React.FC<FeedbackProps> = ({ 
  aiFeedback = [], 
  isAnalyzing = false,
  submissionVerdict 
}) => {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error': return 'bg-red-50 border-red-200 text-red-800';
      case 'warning': return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'info': return 'bg-blue-50 border-blue-200 text-blue-800';
      default: return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return (
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'info':
        return (
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">AI 피드백</h3>
          {submissionVerdict && (
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
              submissionVerdict === 'Accepted' || submissionVerdict.includes('AC')
                ? 'bg-green-100 text-green-800' 
                : 'bg-red-100 text-red-800'
            }`}>
              {submissionVerdict}
            </span>
          )}
        </div>
      </div>

      {/* 컨텐츠 영역 */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* 분석 진행 중 */}
        {isAnalyzing && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-800 mr-3"></div>
              <span className="font-medium">핵심 힌트를 준비하고 있습니다...</span>
            </div>
            <p className="text-sm mt-2 ml-8">채점 결과를 바탕으로 다음에 확인할 부분을 찾고 있습니다.</p>
          </div>
        )}

        {/* AI 피드백 표시 */}
        {aiFeedback && aiFeedback.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 mb-4">
              <svg className="w-5 h-5 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 3.5a1.5 1.5 0 013 0V4a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-.5a1.5 1.5 0 000 3h.5a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-.5a1.5 1.5 0 00-3 0v.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-3a1 1 0 00-1-1h-.5a1.5 1.5 0 010-3H4a1 1 0 001-1V6a1 1 0 011-1h3a1 1 0 001-1v-.5z" />
              </svg>
              <h4 className="text-sm font-semibold text-gray-900">다음 시도를 위한 힌트</h4>
            </div>
            
            {aiFeedback.map((feedback, index) => (
              <div key={feedback.id || index} className={`p-5 rounded-lg border ${getSeverityColor(feedback.severity)}`}>
                <div className="flex items-start">
                  {getSeverityIcon(feedback.severity)}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="font-semibold text-base">{feedback.title}</h5>
                      <span className="text-xs uppercase font-semibold px-2 py-1 bg-white bg-opacity-50 rounded">{feedback.type}</span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-line">{feedback.message}</p>
                    {feedback.code_suggestion && (
                      <div className="mt-4">
                        <h6 className="font-medium text-sm mb-2">💡 개선 제안:</h6>
                        <pre className="bg-gray-900 text-gray-100 p-3 rounded text-xs overflow-x-auto">
                          {feedback.code_suggestion}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 피드백이 없을 때 */}
        {!isAnalyzing && (!aiFeedback || aiFeedback.length === 0) && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">AI 피드백 대기 중</h3>
            <p className="text-sm text-gray-500 max-w-sm">
              코드를 제출하면 채점 결과와 다음에 확인할 핵심 힌트 하나를 보여드립니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Feedback;
