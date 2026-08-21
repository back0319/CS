export interface EncodedObject {
  [key: string]: EncodedValue;
}

export type EncodedValue = string | number | boolean | null | EncodedValue[] | EncodedObject;
export type ValueKind = 'scalar' | 'list' | 'tuple' | 'dict' | 'set' | 'object';

export interface ValueState {
  kind: ValueKind;
  value: EncodedValue;
  length?: number | null;
  truncated_count?: number;
}

export interface ItemChange {
  key: string | number;
  kind: 'created' | 'updated' | 'deleted';
  before?: EncodedValue;
  after?: EncodedValue;
}

export interface VariableChange {
  scope: 'global' | 'local';
  call_id?: number | null;
  name: string;
  kind: 'created' | 'updated' | 'deleted' | 'mutated';
  before?: ValueState;
  after?: ValueState;
  items?: ItemChange[];
}

export interface CallBinding {
  expression: string;
  parameter: string;
  value: EncodedValue;
}

export interface CallSite {
  line: number;
  expression: string;
  order: number;
  bindings: CallBinding[];
}

export interface StackFrame {
  func_name: string;
  call_id?: number;
  encoded_locals: Record<string, EncodedValue>;
  local_states?: Record<string, ValueState>;
  ordered_varnames?: string[];
  line_number: number;
}

export interface CodeBlock {
  type: 'function' | 'if_block' | 'else_block' | 'for_loop' | 'while_loop';
  label: string;
  name: string;
  expression: string;
  start_line: number;
  end_line: number;
  depth: number;
}

export interface ControlState {
  kind: 'condition' | 'loop' | 'loop_control';
  result?: boolean;
  iteration?: number;
  finished?: boolean;
  action?: 'break' | 'continue';
}

export interface Step {
  line: number;
  operation: string;
  statement_kind?: string;
  phase?: 'before' | 'after' | 'call' | 'return' | 'error';
  variables: Record<string, EncodedValue>;
  variables_state?: Record<string, ValueState>;
  output?: string;
  output_delta?: string;
  console_output?: string;
  console_delta?: string;
  description?: string;
  stack_frames?: StackFrame[];
  globals_vars?: Record<string, EncodedValue>;
  globals_state?: Record<string, ValueState>;
  func_name?: string;
  call_id?: number;
  current_blocks?: CodeBlock[];
  condition_result?: boolean | null;
  loop_iteration?: number | null;
  loop_finished?: boolean;
  control_state?: ControlState | null;
  changes?: VariableChange[];
  input_event?: { prompt: string; value: string } | null;
  call_site?: CallSite | null;
  return_value?: EncodedValue;
}

export interface CallTreeNode {
  id: number;
  parent_id: number | null;
  func_name: string;
  arguments: Record<string, EncodedValue>;
  call_step: number;
  return_step: number | null;
  return_value: EncodedValue;
  error_step?: number | null;
  call_site?: CallSite | null;
}

export interface CodeToken {
  name: string;
  start: number;
  end: number;
  kind?: 'keyword' | 'builtin' | 'function' | 'identifier' | 'string' | 'number' | 'comment' | 'operator';
}

export interface VisualizationData {
  steps: Step[];
  code_lines: string[];
  call_tree?: CallTreeNode[];
  tokens_by_line?: Record<string, CodeToken[]>;
  truncated?: boolean;
  truncation_reason?: string | null;
}

export interface ReplayState {
  stepIndex: number;
  lastStep: number;
  isPlaying: boolean;
}

export type ReplayAction =
  | { type: 'load'; stepCount: number }
  | { type: 'first' | 'previous' | 'next' | 'last' | 'toggle' | 'pause' };

export const INITIAL_REPLAY_STATE: ReplayState = {
  stepIndex: 0,
  lastStep: 0,
  isPlaying: false,
};

export function replayReducer(state: ReplayState, action: ReplayAction): ReplayState {
  switch (action.type) {
    case 'load':
      return { stepIndex: 0, lastStep: Math.max(action.stepCount - 1, 0), isPlaying: false };
    case 'first':
      return { ...state, stepIndex: 0, isPlaying: false };
    case 'previous':
      return { ...state, stepIndex: Math.max(0, state.stepIndex - 1), isPlaying: false };
    case 'next': {
      const stepIndex = Math.min(state.lastStep, state.stepIndex + 1);
      return { ...state, stepIndex, isPlaying: stepIndex < state.lastStep && state.isPlaying };
    }
    case 'last':
      return { ...state, stepIndex: state.lastStep, isPlaying: false };
    case 'toggle':
      return { ...state, isPlaying: state.stepIndex < state.lastStep && !state.isPlaying };
    case 'pause':
      return { ...state, isPlaying: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseVisualizationData(value: unknown): VisualizationData {
  if (!isRecord(value) || !Array.isArray(value.steps) || !Array.isArray(value.code_lines)) {
    throw new Error('시각화 응답 형식이 올바르지 않습니다.');
  }
  if (value.steps.length === 0 || value.steps.length > 1_000) {
    throw new Error('시각화 단계 수가 올바르지 않습니다.');
  }
  if (!value.code_lines.every((line) => typeof line === 'string')) {
    throw new Error('시각화 코드 형식이 올바르지 않습니다.');
  }
  for (const step of value.steps) {
    if (
      !isRecord(step)
      || !Number.isInteger(step.line)
      || typeof step.operation !== 'string'
      || !isRecord(step.variables)
      || (step.stack_frames !== undefined && !Array.isArray(step.stack_frames))
      || (step.current_blocks !== undefined && !Array.isArray(step.current_blocks))
      || (step.changes !== undefined && !Array.isArray(step.changes))
    ) {
      throw new Error('시각화 단계 형식이 올바르지 않습니다.');
    }
  }
  if (value.call_tree !== undefined && !Array.isArray(value.call_tree)) {
    throw new Error('함수 호출 trace 형식이 올바르지 않습니다.');
  }
  if (value.tokens_by_line !== undefined && !isRecord(value.tokens_by_line)) {
    throw new Error('코드 token 형식이 올바르지 않습니다.');
  }
  return value as unknown as VisualizationData;
}

export interface ReplayViewModel {
  stepIndex: number;
  lastStep: number;
  progress: number;
  step: Step;
  allCalls: CallTreeNode[];
  callsById: Map<number, CallTreeNode>;
  activeFrames: StackFrame[];
  activeCallIds: Set<number>;
  currentCallId?: number;
  visibleNames: Set<string>;
}

export function createReplayViewModel(data: VisualizationData, requestedStep: number): ReplayViewModel {
  const lastStep = data.steps.length - 1;
  const stepIndex = Math.min(Math.max(Math.trunc(requestedStep), 0), lastStep);
  const step = data.steps[stepIndex];
  const allCalls = data.call_tree || [];
  const callsById = new Map(allCalls.map((call) => [call.id, call]));
  const activeFrames = (step.stack_frames || []).filter((frame) => frame.func_name !== 'Global frame');
  const activeCallIds = new Set(
    activeFrames.map((frame) => frame.call_id).filter((id): id is number => typeof id === 'number'),
  );
  const currentCallId = activeFrames[activeFrames.length - 1]?.call_id ?? step.call_id;
  const visibleNames = new Set(Object.keys(step.variables_state || step.variables || {}));
  for (const frame of step.stack_frames || []) {
    for (const name of Object.keys(frame.local_states || frame.encoded_locals || {})) {
      visibleNames.add(name);
    }
  }
  return {
    stepIndex,
    lastStep,
    progress: ((stepIndex + 1) / data.steps.length) * 100,
    step,
    allCalls,
    callsById,
    activeFrames,
    activeCallIds,
    currentCallId,
    visibleNames,
  };
}

export function selectFrameArguments(
  view: ReplayViewModel,
  frame: StackFrame,
): Record<string, EncodedValue> {
  const call = typeof frame.call_id === 'number' ? view.callsById.get(frame.call_id) : undefined;
  if (!call) return {};
  return Object.fromEntries(
    Object.entries(call.arguments).map(([name, initialValue]) => [
      name,
      Object.prototype.hasOwnProperty.call(frame.encoded_locals, name)
        ? frame.encoded_locals[name]
        : initialValue,
    ]),
  );
}

export function selectLatestControlStep(
  data: VisualizationData,
  view: ReplayViewModel,
  block: CodeBlock,
): Step | undefined {
  for (let index = view.stepIndex; index >= 0; index -= 1) {
    const candidate = data.steps[index];
    if (candidate.call_id === view.step.call_id && candidate.line === block.start_line) return candidate;
  }
  return undefined;
}

export function selectCallDepth(view: ReplayViewModel, call: CallTreeNode): number {
  let depth = 0;
  let parentId = call.parent_id;
  while (parentId !== null && depth < 20) {
    depth += 1;
    parentId = view.callsById.get(parentId)?.parent_id ?? null;
  }
  return depth;
}

export function selectCallStatus(
  view: ReplayViewModel,
  call: CallTreeNode,
  formatValue: (value: EncodedValue | undefined) => string,
) {
  if (typeof call.error_step === 'number' && call.error_step <= view.stepIndex) {
    return { label: '오류', className: 'border-red-300 bg-red-50 text-red-900' };
  }
  if (call.id === view.currentCallId) {
    return { label: '실행 중', className: 'border-amber-400 bg-amber-50 text-amber-950' };
  }
  if (view.activeCallIds.has(call.id)) {
    return { label: '하위 호출 대기', className: 'border-amber-300 bg-amber-50 text-amber-950' };
  }
  if (call.return_step !== null && call.return_step <= view.stepIndex) {
    return { label: `반환 ${formatValue(call.return_value)}`, className: 'border-emerald-300 bg-emerald-50 text-emerald-950' };
  }
  return { label: '호출됨', className: 'border-gray-300 bg-white text-gray-800' };
}
