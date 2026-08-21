import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Node's type-stripping runner requires the explicit .ts extension.
import { createReplayViewModel, parseVisualizationData, replayReducer, selectLatestControlStep, INITIAL_REPLAY_STATE } from './visualization-contract.ts';

const trace = parseVisualizationData({
  code_lines: ['x = 1', 'print(x)'],
  steps: [
    { line: 1, operation: 'assign', variables: { x: 1 }, call_id: 1, condition_result: true },
    {
      line: 2,
      operation: 'print',
      variables: { x: 1 },
      call_id: 1,
      stack_frames: [{ func_name: 'solve', call_id: 1, encoded_locals: { x: 1 }, line_number: 2 }],
    },
  ],
  call_tree: [{
    id: 1, parent_id: null, func_name: 'solve', arguments: {}, call_step: 0,
    return_step: null, return_value: null,
  }],
});

test('trace schema는 빈 단계와 잘못된 단계 모양을 거부한다', () => {
  assert.throws(() => parseVisualizationData({ steps: [], code_lines: [] }), /단계 수/);
  assert.throws(() => parseVisualizationData({
    steps: [{ line: '1', operation: 'x', variables: {} }], code_lines: ['x'],
  }), /단계 형식/);
});

test('같은 trace와 step은 같은 replay view model을 만든다', () => {
  const first = createReplayViewModel(trace, 1);
  const second = createReplayViewModel(trace, 1);
  assert.equal(first.step, second.step);
  assert.equal(first.currentCallId, 1);
  assert.deepEqual(Array.from(first.visibleNames), Array.from(second.visibleNames));
  assert.deepEqual(Array.from(first.activeCallIds), [1]);
  assert.equal(first.progress, 100);
});

test('step 범위를 고정하고 같은 호출의 최근 조건 상태를 선택한다', () => {
  const view = createReplayViewModel(trace, 99);
  assert.equal(view.stepIndex, 1);
  assert.equal(selectLatestControlStep(trace, view, {
    type: 'if_block', label: 'if', name: 'if', expression: 'x', start_line: 1, end_line: 2, depth: 0,
  })?.condition_result, true);
});

test('replay reducer는 재생 경계를 넘지 않는다', () => {
  const loaded = replayReducer(INITIAL_REPLAY_STATE, { type: 'load', stepCount: 2 });
  const playing = replayReducer(loaded, { type: 'toggle' });
  const last = replayReducer(playing, { type: 'next' });
  assert.deepEqual(last, { stepIndex: 1, lastStep: 1, isPlaying: false });
  assert.equal(replayReducer(last, { type: 'next' }).stepIndex, 1);
});

async function runVisualization(code: string, inputData: string) {
  const workdir = await mkdtemp(path.join(tmpdir(), 'didim-trace-'));
  const runnerPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../sandbox/visualize_runner.py',
  );
  try {
    await Promise.all([
      writeFile(path.join(workdir, 'visualize_runner.py'), await readFile(runnerPath)),
      writeFile(path.join(workdir, 'request.json'), JSON.stringify({ code, input_data: inputData })),
    ]);
    const process = spawnSync('python3', ['visualize_runner.py'], {
      cwd: workdir,
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(process.status, 0, process.stderr);
    assert.equal(process.stdout, '');
    return parseVisualizationData(JSON.parse(await readFile(path.join(workdir, 'trace.json'), 'utf8')));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

test('sys.stdout.write와 builtins.print도 trace 출력에 포함된다', async () => {
  const result = await runVisualization(
    'import builtins\nimport sys\nsys.stdout.write("A")\nbuiltins.print("B")',
    '',
  );
  const output = result.steps[result.steps.length - 1].console_output || '';
  assert.equal(output, 'AB');
});

test('os.write와 sys.__stdout__은 trace JSON 프로토콜을 오염시키지 않는다', async () => {
  const result = await runVisualization(
    'import os\nimport sys\nos.write(1, b"raw")\nsys.__stdout__.write("dunder")\nprint("safe")',
    '',
  );
  const output = result.steps[result.steps.length - 1].console_output || '';
  assert.equal(output, 'dundersafe');
  assert.equal(output.includes('raw'), false);
});

test('입력이 소진되면 빈 문자열 대신 실제 input처럼 EOFError가 발생한다', async () => {
  const result = await runVisualization('input()\ninput()', 'one\n');
  assert.match(JSON.stringify(result.steps), /EOFError/);
});
