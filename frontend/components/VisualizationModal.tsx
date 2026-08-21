import React, { useEffect, useMemo, useReducer, useState } from 'react';
import {
  createReplayViewModel,
  INITIAL_REPLAY_STATE,
  parseVisualizationData,
  replayReducer,
  selectCallDepth,
  selectCallStatus,
  selectFrameArguments,
  selectLatestControlStep,
  type CallBinding,
  type CallTreeNode,
  type CodeBlock,
  type CodeToken,
  type EncodedValue,
  type StackFrame,
  type Step,
  type ValueState,
  type VariableChange,
  type VisualizationData,
} from '../lib/visualization-contract';

interface VisualizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  inputData?: string;
}

const COLOR_PALETTE = [
  { highlight: 'bg-blue-200 text-blue-950', box: 'border-blue-200 bg-blue-50', text: 'text-blue-900', accent: 'border-blue-500' },
  { highlight: 'bg-green-200 text-green-950', box: 'border-green-200 bg-green-50', text: 'text-green-900', accent: 'border-green-500' },
  { highlight: 'bg-purple-200 text-purple-950', box: 'border-purple-200 bg-purple-50', text: 'text-purple-900', accent: 'border-purple-500' },
  { highlight: 'bg-pink-200 text-pink-950', box: 'border-pink-200 bg-pink-50', text: 'text-pink-900', accent: 'border-pink-500' },
  { highlight: 'bg-yellow-200 text-yellow-950', box: 'border-yellow-200 bg-yellow-50', text: 'text-yellow-900', accent: 'border-yellow-500' },
  { highlight: 'bg-indigo-200 text-indigo-950', box: 'border-indigo-200 bg-indigo-50', text: 'text-indigo-900', accent: 'border-indigo-500' },
  { highlight: 'bg-red-200 text-red-950', box: 'border-red-200 bg-red-50', text: 'text-red-900', accent: 'border-red-500' },
  { highlight: 'bg-orange-200 text-orange-950', box: 'border-orange-200 bg-orange-50', text: 'text-orange-900', accent: 'border-orange-500' },
] as const;

const EMPTY_CALLS: CallTreeNode[] = [];
const EMPTY_CALL_MAP = new Map<number, CallTreeNode>();
const EMPTY_FRAMES: StackFrame[] = [];
const EMPTY_NAMES = new Set<string>();

const FUNCTION_COLOR = {
  highlight: 'bg-sky-200 text-sky-950',
  codeHighlight: 'bg-sky-400/20 text-sky-200',
} as const;

const SYNTAX_COLORS: Record<NonNullable<CodeToken['kind']>, string> = {
  keyword: 'font-semibold text-fuchsia-300',
  builtin: 'text-cyan-300',
  function: FUNCTION_COLOR.codeHighlight,
  identifier: 'text-gray-300',
  string: 'text-amber-300',
  number: 'text-orange-300',
  comment: 'italic text-gray-500',
  operator: 'text-gray-400',
};

const variableColor = (name: string) => {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = ((hash * 31) + name.charCodeAt(index)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
};

const formatValue = (value: EncodedValue | undefined): string => {
  if (value === undefined) return '';
  if (value === null) return 'None';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') {
    const rendered = JSON.stringify(value);
    return rendered.length > 80 ? `${rendered.slice(0, 77)}...` : rendered;
  }
  return String(value);
};

const inferValueState = (value: EncodedValue): ValueState => {
  if (Array.isArray(value)) return { kind: 'list', value, length: value.length };
  if (value !== null && typeof value === 'object') {
    return { kind: 'dict', value, length: Object.keys(value).length };
  }
  return { kind: 'scalar', value };
};

function FunctionSignature({
  funcName,
  arguments: argumentValues,
}: {
  funcName: string;
  arguments: Record<string, EncodedValue>;
}) {
  const entries = Object.entries(argumentValues);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center font-mono font-semibold">
      <span className={`${FUNCTION_COLOR.highlight} rounded px-1`}>{funcName}</span>
      <span className="text-gray-500">(</span>
      {entries.map(([name, value], index) => {
        const colors = variableColor(name);
        return (
          <React.Fragment key={name}>
            {index > 0 && <span className="mr-1 text-gray-500">,</span>}
            <span className={`${colors.highlight} rounded px-1`}>{name}</span>
            <span className="text-gray-500">=</span>
            <span className="text-orange-700">{formatValue(value)}</span>
          </React.Fragment>
        );
      })}
      <span className="text-gray-500">)</span>
    </span>
  );
}

function InlineIdentifiers({ text, visibleNames }: { text: string; visibleNames: Set<string> }) {
  const parts: React.ReactNode[] = [];
  let index = 0;
  let plainStart = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) parts.push(text.slice(plainStart, end));
  };

  while (index < text.length) {
    const character = text[index];
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        index += 1;
        if (text[index - 1] === quote) break;
      }
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
      const name = text.slice(index, end);
      if (visibleNames.has(name)) {
        flushPlain(index);
        const colors = variableColor(name);
        parts.push(
          <span key={`${name}-${index}`} className={`${colors.highlight} rounded px-1 font-semibold`}>
            {name}
          </span>,
        );
        plainStart = end;
      }
      index = end;
      continue;
    }
    index += 1;
  }
  flushPlain(text.length);
  return <>{parts}</>;
}

function TokenizedCodeLine({
  line,
  tokens,
  visibleNames,
}: {
  line: string;
  tokens: CodeToken[];
  visibleNames: Set<string>;
}) {
  if (!tokens.length) return <>{line || ' '}</>;
  const fragments: React.ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token) => {
    if (token.start > cursor) fragments.push(line.slice(cursor, token.start));
    const name = line.slice(token.start, token.end);
    if (token.kind === 'function') {
      fragments.push(
        <span key={`${token.start}-${token.end}`} className={`${FUNCTION_COLOR.codeHighlight} rounded px-0.5 font-semibold`}>
          {name}
        </span>,
      );
    } else if (token.kind === 'identifier' && visibleNames.has(token.name)) {
      const colors = variableColor(token.name);
      fragments.push(
        <span key={`${token.start}-${token.end}`} className={`${colors.highlight} rounded px-0.5 font-semibold`}>
          {name}
        </span>,
      );
    } else {
      fragments.push(
        <span key={`${token.start}-${token.end}`} className={token.kind ? SYNTAX_COLORS[token.kind] : undefined}>
          {name}
        </span>,
      );
    }
    cursor = token.end;
  });
  if (cursor < line.length) fragments.push(line.slice(cursor));
  return <>{fragments}</>;
}

function CollectionValue({ state, changedItems }: { state: ValueState; changedItems: Set<string> }) {
  const value = state.value;
  if ((state.kind === 'list' || state.kind === 'tuple') && Array.isArray(value)) {
    return (
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {value.map((item, index) => (
          <div
            key={index}
            className={`min-w-0 rounded border px-1.5 py-1 text-center ${
              changedItems.has(String(index)) ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white/70'
            }`}
          >
            <div className="text-[10px] text-gray-400">{index}</div>
            <div className="break-all font-mono text-xs text-gray-900">{formatValue(item)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (state.kind === 'dict' && value !== null && !Array.isArray(value) && typeof value === 'object') {
    return (
      <div className="mt-2 space-y-1">
        {Object.entries(value).map(([key, item]) => (
          <div
            key={key}
            className={`flex min-w-0 items-start justify-between gap-2 rounded border px-2 py-1 ${
              changedItems.has(key) ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white/70'
            }`}
          >
            <span className="break-all font-mono text-[11px] text-gray-500">{key}</span>
            <span className="break-all text-right font-mono text-xs text-gray-900">{formatValue(item)}</span>
          </div>
        ))}
      </div>
    );
  }
  if (state.kind === 'set' && Array.isArray(value)) {
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        {value.map((item, index) => (
          <span
            key={`${formatValue(item)}-${index}`}
            className={`rounded border px-2 py-1 font-mono text-xs ${
              changedItems.has(formatValue(item)) ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white/70'
            }`}
          >
            {formatValue(item)}
          </span>
        ))}
      </div>
    );
  }
  return <div className="mt-1 break-all font-mono text-sm text-gray-900">{formatValue(value)}</div>;
}

function VariableCards({
  values,
  states,
  changes,
  orderedNames,
  excludedNames,
}: {
  values: Record<string, EncodedValue>;
  states?: Record<string, ValueState>;
  changes: VariableChange[];
  orderedNames?: string[];
  excludedNames?: Set<string>;
}) {
  const names = (orderedNames?.filter((name) => name !== '__return__' && name in values)
    ?? Object.keys(values).filter((name) => name !== '__return__'))
    .filter((name) => !excludedNames?.has(name));
  if (!names.length) return <p className="text-xs text-gray-400">표시할 변수가 없습니다.</p>;

  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      {names.map((name) => {
        const state = states?.[name] ?? inferValueState(values[name]);
        const change = changes.find((candidate) => candidate.name === name);
        const changedItems = new Set((change?.items || []).map((item) => String(item.key)));
        const colors = variableColor(name);
        const isScalar = state.kind === 'scalar';
        return (
          <div
            key={name}
            className={`min-w-0 rounded-lg border border-gray-200 bg-white ${
              isScalar ? 'flex min-w-[108px] flex-1 items-center gap-2 px-2 py-1.5' : 'w-full p-2.5'
            } ${change ? 'border-l-4 border-l-amber-400' : ''}`}
          >
            <div className={`flex min-w-0 items-center gap-2 ${isScalar ? '' : 'justify-between'}`}>
              <span className={`${colors.highlight} break-all rounded px-1 font-mono text-sm font-bold`}>{name}</span>
              {!isScalar && (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  {state.kind}
                </span>
              )}
            </div>
            {isScalar ? (
              <span className="flex min-w-0 items-center gap-1 font-mono text-sm text-gray-900">
                <span className="text-gray-400">=</span>
                <span className="min-w-0 break-all">{formatValue(state.value)}</span>
              </span>
            ) : (
              <CollectionValue state={state} changedItems={changedItems} />
            )}
            {!!state.truncated_count && state.truncated_count > 0 && (
              <p className="mt-1 text-[10px] text-gray-500">외 {state.truncated_count}개</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BindingRows({ bindings, visibleNames }: { bindings: CallBinding[]; visibleNames: Set<string> }) {
  if (!bindings.length) return null;
  return (
    <div className="mt-2 space-y-1 rounded-md border border-gray-200 bg-gray-50/80 p-2">
      {bindings.map((binding, index) => {
        const parameterColors = variableColor(binding.parameter);
        return (
          <div key={`${binding.parameter}-${index}`} className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-[11px]">
            <span className="break-all text-gray-700">
              <InlineIdentifiers text={binding.expression} visibleNames={visibleNames} /> = {formatValue(binding.value)}
            </span>
            <span className="text-gray-400">→</span>
            <span className={`${parameterColors.highlight} rounded px-1 font-semibold`}>
              {binding.parameter} = {formatValue(binding.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function VisualizationModal({
  isOpen,
  onClose,
  code,
  inputData = '',
}: VisualizationModalProps) {
  const [visualizationData, setVisualizationData] = useState<VisualizationData | null>(null);
  const [replayState, dispatchReplay] = useReducer(replayReducer, INITIAL_REPLAY_STATE);
  const currentStep = replayState.stepIndex;
  const isPlaying = replayState.isPlaying;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !code) return;
    const controller = new AbortController();
    const generateVisualization = async () => {
      setIsLoading(true);
      setError(null);
      dispatchReplay({ type: 'pause' });
      try {
        const response = await fetch('/api/visualize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, language: 'python', input_data: inputData }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '시각화 생성에 실패했습니다.');
        const parsed = parseVisualizationData(data);
        setVisualizationData(parsed);
        dispatchReplay({ type: 'load', stepCount: parsed.steps.length });
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setError(requestError instanceof Error ? requestError.message : '시각화 생성 중 오류가 발생했습니다.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    generateVisualization();
    return () => controller.abort();
  }, [isOpen, code, inputData]);

  useEffect(() => {
    if (!isPlaying || !visualizationData) return;
    if (currentStep >= visualizationData.steps.length - 1) {
      dispatchReplay({ type: 'pause' });
      return;
    }
    const timer = window.setTimeout(() => dispatchReplay({ type: 'next' }), 850);
    return () => window.clearTimeout(timer);
  }, [isPlaying, visualizationData, currentStep]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  const replay = useMemo(
    () => visualizationData ? createReplayViewModel(visualizationData, currentStep) : null,
    [visualizationData, currentStep],
  );
  const step = replay?.step;
  const allCalls = replay?.allCalls || EMPTY_CALLS;
  const callsById = replay?.callsById || EMPTY_CALL_MAP;
  const activeFrames = replay?.activeFrames || EMPTY_FRAMES;
  const currentCallId = replay?.currentCallId;
  const visibleNames = replay?.visibleNames || EMPTY_NAMES;

  const frameArguments = (frame: StackFrame): Record<string, EncodedValue> => {
    return replay ? selectFrameArguments(replay, frame) : {};
  };

  const latestControlStep = (block: CodeBlock): Step | undefined => {
    return visualizationData && replay
      ? selectLatestControlStep(visualizationData, replay, block)
      : undefined;
  };

  const callStatus = (call: CallTreeNode) => {
    return replay
      ? selectCallStatus(replay, call, formatValue)
      : { label: '호출됨', className: 'border-gray-300 bg-white text-gray-800' };
  };

  const callDepth = (call: CallTreeNode) => {
    return replay ? selectCallDepth(replay, call) : 0;
  };

  const renderCurrentFlow = () => {
    if (!step) return null;
    const currentFrame = activeFrames[activeFrames.length - 1];
    const currentBlocks = (step.current_blocks || []).filter((block) => block.type !== 'function');
    const functionBlock = (step.current_blocks || []).find((block) => block.type === 'function');
    const title = currentFrame ? (
      <FunctionSignature funcName={currentFrame.func_name} arguments={frameArguments(currentFrame)} />
    ) : functionBlock ? `${functionBlock.expression} 정의` : '전역 코드';
    const stepChanges = step.changes || [];

    return (
      <section aria-labelledby="current-flow-title" className="space-y-3">
        <h4 id="current-flow-title" className="text-sm font-semibold text-gray-900">현재 실행 흐름</h4>
        <div className="min-w-0 rounded-lg border border-amber-400 bg-amber-50 p-3 ring-1 ring-amber-200">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded bg-fuchsia-600 px-2 py-0.5 font-mono text-xs font-bold text-white">def</span>
              <span className="break-all font-mono text-sm font-semibold text-gray-950">{title}</span>
            </div>
            <span className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-800">
              {step.description || '코드 실행'}
            </span>
          </div>
          {step.call_site?.bindings && (
            <BindingRows bindings={step.call_site.bindings} visibleNames={visibleNames} />
          )}

          {currentBlocks.length > 0 && (
            <div className="mt-3 space-y-2 border-l-2 border-amber-300 pl-3">
              {currentBlocks.map((block) => {
                const controlStep = latestControlStep(block);
                const isCondition = block.type === 'if_block';
                const isLoop = block.type === 'for_loop' || block.type === 'while_loop';
                const isElse = block.type === 'else_block';
                const palette = isLoop
                  ? 'border-purple-300 bg-purple-50 text-purple-950'
                  : 'border-blue-300 bg-blue-50 text-blue-950';
                const badge = isLoop ? 'bg-purple-600' : 'bg-blue-600';
                return (
                  <div key={`${block.type}-${block.start_line}`} className={`min-w-0 rounded-lg border p-2.5 ${palette}`}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold text-white ${badge}`}>
                        {block.label}
                      </span>
                      {!!block.expression && (
                        <code className="min-w-0 break-all text-xs font-semibold">
                          <InlineIdentifiers text={block.expression} visibleNames={visibleNames} />
                        </code>
                      )}
                      {isCondition && typeof controlStep?.condition_result === 'boolean' && (
                        <span className={`ml-auto rounded px-2 py-0.5 text-xs font-bold text-white ${
                          controlStep.condition_result ? 'bg-green-600' : 'bg-red-600'
                        }`}>
                          {controlStep.condition_result ? '참' : '거짓'}
                        </span>
                      )}
                      {isElse && <span className="ml-auto text-xs font-semibold text-blue-700">선택된 분기</span>}
                      {isLoop && typeof controlStep?.loop_iteration === 'number' && (
                        <span className={`ml-auto rounded px-2 py-0.5 text-xs font-bold ${
                          controlStep.loop_finished ? 'bg-gray-200 text-gray-700' : 'bg-purple-200 text-purple-900'
                        }`}>
                          {controlStep.loop_finished ? '반복 종료' : `${controlStep.loop_iteration}번째 반복`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {(stepChanges.length > 0 || step.input_event || step.output_delta || step.control_state?.action) && (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h5 className="mb-2 text-xs font-semibold text-gray-500">이번 단계에서 달라진 점</h5>
            <div className="space-y-1.5 text-xs text-gray-700">
              {step.input_event && <p>입력값 <code className="font-semibold">{formatValue(step.input_event.value)}</code>을 사용했습니다.</p>}
              {stepChanges.slice(0, 5).map((change) => {
                const colors = variableColor(change.name);
                const action = change.kind === 'created' ? '생성' : change.kind === 'deleted' ? '삭제' : change.kind === 'mutated' ? '내용 변경' : '값 변경';
                return (
                  <p key={`${change.scope}-${change.call_id}-${change.name}`}>
                    <span className={`${colors.highlight} rounded px-1 font-mono font-semibold`}>{change.name}</span> {action}
                  </p>
                );
              })}
              {step.output_delta && <p>출력에 <code className="font-semibold">{formatValue(step.output_delta.replace(/\n$/, ''))}</code>이 추가됐습니다.</p>}
              {step.control_state?.action === 'break' && <p>현재 반복문을 중단했습니다.</p>}
              {step.control_state?.action === 'continue' && <p>남은 코드를 건너뛰고 다음 반복으로 이동했습니다.</p>}
            </div>
          </div>
        )}
      </section>
    );
  };

  const renderCalls = () => {
    if (!allCalls.length) return null;
    const startedCalls = allCalls.filter((call) => call.call_step <= currentStep);
    const activeCall = typeof currentCallId === 'number' ? callsById.get(currentCallId) : undefined;
    const focusCall = activeCall ?? startedCalls[startedCalls.length - 1];
    if (!focusCall) return null;
    const focusParentId = focusCall.parent_id ?? focusCall.id;
    const relatedCalls = focusParentId === null
      ? startedCalls.filter((call) => call.parent_id === null)
      : startedCalls.filter((call) => call.parent_id === focusParentId);

    return (
      <section aria-labelledby="call-flow-title" className="space-y-3 border-t border-gray-200 pt-4">
        <div>
          <h4 id="call-flow-title" className="text-sm font-semibold text-gray-900">함수 호출 흐름</h4>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">같은 식의 호출을 실제 실행 순서와 상태로 구분합니다.</p>
        </div>
        {relatedCalls.length > 0 && (
          <div className="grid min-w-0 grid-cols-2 gap-2">
            {relatedCalls.map((call) => {
              const status = callStatus(call);
              return (
                <div key={call.id} className={`min-w-0 rounded-lg border p-2.5 ${status.className}`}>
                  <div className="break-all text-xs font-bold">
                    <FunctionSignature funcName={call.func_name} arguments={call.arguments} />
                  </div>
                  <div className="mt-1 text-[11px] font-semibold">{status.label}</div>
                  {call.call_site?.bindings && (
                    <BindingRows bindings={call.call_site.bindings} visibleNames={visibleNames} />
                  )}
                </div>
              );
            })}
          </div>
        )}
        <details open className="rounded-lg border border-gray-200 bg-white">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-gray-700">전체 호출 기록</summary>
          <div className="max-h-72 space-y-1 overflow-y-auto border-t border-gray-100 p-2">
            {startedCalls.map((call) => {
              const status = callStatus(call);
              const depth = callDepth(call);
              return (
                <div
                  key={call.id}
                  className={`min-w-0 rounded border-l-2 px-2 py-1 ${status.className}`}
                  style={{ marginLeft: `${Math.min(depth, 4) * 10}px` }}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="break-all text-[11px] font-semibold">
                      <FunctionSignature funcName={call.func_name} arguments={call.arguments} />
                    </span>
                    <span className="shrink-0 text-[10px] font-medium">{status.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </section>
    );
  };

  if (!isOpen) return null;
  const lastStep = replay?.lastStep || 0;
  const progress = replay?.progress || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4" role="dialog" aria-modal="true" aria-label="코드 시각화">
      <div className="flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-950">코드 시각화</h2>
            <p className="mt-0.5 text-xs text-gray-500">실제 실행 순서에 따라 변수, 조건, 반복과 함수 호출을 보여줍니다.</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900" aria-label="시각화 닫기">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {isLoading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-600" />
              <p className="text-sm text-gray-600">실행 과정을 추적하고 있습니다.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-center text-sm text-red-700">{error}</div>
          </div>
        )}

        {!isLoading && !error && visualizationData && step && (
          <>
            {visualizationData.truncated && (
              <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-xs font-medium text-amber-800">
                실행 단계가 많아 {visualizationData.steps.length}단계까지만 표시합니다.
              </div>
            )}
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.85fr)_minmax(360px,1.25fr)_minmax(420px,1.4fr)] overflow-hidden">
              <section className="min-h-0 min-w-0 border-r border-gray-200" aria-labelledby="state-title">
                <div className="border-b border-blue-200 bg-blue-50 px-4 py-3">
                  <h3 id="state-title" className="text-sm font-semibold text-blue-900">실행 상태</h3>
                </div>
                <div className="h-[calc(100%-45px)] space-y-4 overflow-y-auto overflow-x-hidden p-3">
                  {Object.keys(step.globals_vars || {}).length > 0 && (
                    <div className="flex min-w-0 items-start gap-2">
                      <h4 className="w-20 shrink-0 whitespace-nowrap pt-2 text-xs font-semibold text-gray-500">전역 변수</h4>
                      <div className="min-w-0 flex-1">
                        <VariableCards
                          values={step.globals_vars || {}}
                          states={step.globals_state}
                          changes={(step.changes || []).filter((change) => change.scope === 'global')}
                        />
                      </div>
                    </div>
                  )}

                  {activeFrames.length > 0 && (
                    <div className="flex min-w-0 items-start gap-2">
                      <h4 className="w-20 shrink-0 whitespace-nowrap pt-2 text-xs font-semibold text-gray-500">함수 호출 스택</h4>
                      <div className="min-w-0 flex-1 space-y-2">
                        {activeFrames.map((frame, index) => {
                          const isCurrent = index === activeFrames.length - 1;
                          const call = typeof frame.call_id === 'number' ? callsById.get(frame.call_id) : undefined;
                          const parameterNames = new Set(Object.keys(call?.arguments || {}));
                          const localChanges = (step.changes || []).filter(
                            (change) => change.scope === 'local' && change.call_id === frame.call_id,
                          );
                          return (
                            <div key={`${frame.call_id || frame.func_name}-${index}`} className={`min-w-0 rounded-lg border p-2.5 ${
                              isCurrent ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200' : 'border-gray-200 bg-white'
                            }`}>
                              <div className="flex min-w-0 items-center justify-between gap-2">
                                <span className="break-all text-xs font-bold text-gray-900">
                                  <FunctionSignature funcName={frame.func_name} arguments={frameArguments(frame)} />
                                </span>
                                {isCurrent && <span className="shrink-0 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">현재</span>}
                              </div>
                              {call?.call_site?.bindings && (
                                <BindingRows bindings={call.call_site.bindings} visibleNames={visibleNames} />
                              )}
                              {Object.keys(frame.encoded_locals || {}).some((name) => !parameterNames.has(name)) && (
                                <div className="mt-2">
                                <VariableCards
                                  values={frame.encoded_locals || {}}
                                  states={frame.local_states}
                                  changes={localChanges}
                                  orderedNames={frame.ordered_varnames}
                                  excludedNames={parameterNames}
                                />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {Object.keys(step.globals_vars || {}).length === 0 && activeFrames.length === 0 && (
                    <p className="pt-6 text-center text-sm text-gray-400">아직 생성된 변수가 없습니다.</p>
                  )}
                </div>
              </section>

              <section className="min-h-0 min-w-0 border-r border-gray-200" aria-labelledby="flow-title">
                <div className="border-b border-green-200 bg-green-50 px-4 py-3">
                  <h3 id="flow-title" className="text-sm font-semibold text-green-900">코드 흐름</h3>
                </div>
                <div className="h-[calc(100%-45px)] space-y-4 overflow-y-auto overflow-x-hidden p-4">
                  {renderCurrentFlow()}
                  {renderCalls()}
                </div>
              </section>

              <section className="flex min-h-0 min-w-0 flex-col" aria-labelledby="code-title">
                <div className="border-b border-purple-200 bg-purple-50 px-4 py-3">
                  <h3 id="code-title" className="text-sm font-semibold text-purple-900">코드</h3>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-gray-950 py-2 font-mono text-sm">
                  {visualizationData.code_lines.map((line, index) => {
                    const lineNumber = index + 1;
                    const isCurrentLine = step.line === lineNumber;
                    const tokens = visualizationData.tokens_by_line?.[String(lineNumber)] || [];
                    return (
                      <div key={lineNumber} className={`flex ${isCurrentLine ? 'bg-yellow-400/25' : ''}`}>
                        <span className={`w-12 shrink-0 select-none py-1 pr-4 text-right ${
                          isCurrentLine ? 'font-bold text-yellow-300' : 'text-gray-600'
                        }`}>
                          {lineNumber}
                        </span>
                        <code className={`min-w-0 whitespace-pre py-1 pr-6 ${isCurrentLine ? 'text-yellow-50' : 'text-gray-300'}`}>
                          <TokenizedCodeLine line={line} tokens={tokens} visibleNames={visibleNames} />
                        </code>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-gray-800 bg-gray-950">
                  <div className="border-b border-gray-800 px-4 py-2 text-xs font-semibold text-gray-400">출력</div>
                  <div className="max-h-32 min-h-16 overflow-y-auto p-4">
                    {(step.console_output ?? step.output) ? (
                      <pre className="whitespace-pre-wrap font-mono text-sm text-emerald-400">{step.console_output ?? step.output}</pre>
                    ) : (
                      <p className="text-xs text-gray-600">아직 입력이나 출력이 없습니다.</p>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <footer className="border-t border-gray-200 bg-white px-6 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => dispatchReplay({ type: 'first' })} disabled={currentStep === 0} className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">처음</button>
                  <button onClick={() => dispatchReplay({ type: 'previous' })} disabled={currentStep === 0} className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">이전</button>
                  <button onClick={() => dispatchReplay({ type: 'toggle' })} className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                    {isPlaying ? '일시정지' : '재생'}
                  </button>
                  <button onClick={() => dispatchReplay({ type: 'next' })} disabled={currentStep >= lastStep} className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">다음</button>
                  <button onClick={() => dispatchReplay({ type: 'last' })} disabled={currentStep >= lastStep} className="rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">마지막</button>
                </div>
                <span className="text-xs font-medium text-gray-600">{currentStep + 1} / {visualizationData.steps.length}</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full bg-indigo-600 transition-[width] duration-200" style={{ width: `${progress}%` }} />
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
