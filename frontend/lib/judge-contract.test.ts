import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error Node's type-stripping runner requires the explicit .ts extension.
import { decideCaseVerdict, normalizeOutput, parseRunnerResult, summarizeJudgeResults, toPublicSubmissionResponse, type RunnerResult } from './judge-contract.ts';

const ok = (stdout: string): RunnerResult => ({
  outcome: 'OK',
  stdout,
  stderr: '',
  executionTimeMs: 1,
});

test('출력 비교는 전체 앞뒤 공백과 줄바꿈 형식만 정규화한다', () => {
  assert.equal(normalizeOutput('  answer\r\n'), 'answer');
  assert.equal(decideCaseVerdict(ok('  answer\n'), 'answer').verdict, 'AC');
  assert.equal(decideCaseVerdict(ok('a  b'), 'a b').verdict, 'WA');
  assert.equal(decideCaseVerdict(ok(''), '').verdict, 'AC');
});

test('runner outcome은 고정된 공개 verdict로 변환된다', () => {
  assert.equal(decideCaseVerdict({ ...ok(''), outcome: 'COMPILE_ERROR' }, '').verdict, 'CE');
  assert.equal(decideCaseVerdict({ ...ok(''), outcome: 'RUNTIME_ERROR' }, '').verdict, 'RE');
  assert.equal(decideCaseVerdict({ ...ok(''), outcome: 'TIMED_OUT' }, '').verdict, 'TLE');
  const outputLimit = decideCaseVerdict({ ...ok(''), outcome: 'OUTPUT_LIMIT' }, '');
  assert.equal(outputLimit.verdict, 'RE');
  assert.equal(outputLimit.failureCategory, 'output_limit');
});

test('전체 판정은 첫 실패와 실제 실행 시간 합계를 사용한다', () => {
  assert.deepEqual(
    summarizeJudgeResults([
      { verdict: 'AC', executionTimeMs: 1.25 },
      { verdict: 'WA', executionTimeMs: 2.5, failureCategory: 'wrong_answer' },
    ]),
    { verdict: 'WA', executionTimeMs: 3.75, failureCategory: 'wrong_answer' },
  );
  assert.throws(() => summarizeJudgeResults([]), /테스트 케이스/);
});

test('runner 응답은 허용된 outcome, 시간, 64KiB 출력만 수용한다', () => {
  assert.equal(parseRunnerResult({
    outcome: 'OK', stdout: 'ok', stderr: '', execution_time: 1,
  }).outcome, 'OK');
  assert.throws(() => parseRunnerResult({
    outcome: 'AC', stdout: '', stderr: '', execution_time: 1,
  }), /실행 결과/);
  assert.throws(() => parseRunnerResult({
    outcome: 'OK', stdout: 'x'.repeat(64 * 1024 + 1), stderr: '', execution_time: 1,
  }), /출력 한도/);
});

test('공개 제출 응답에는 테스트 상세와 실행 원문이 포함되지 않는다', () => {
  const response = toPublicSubmissionResponse(
    'attempt-1',
    { verdict: 'WA', executionTimeMs: 12, failureCategory: 'wrong_answer' },
    [{ id: 1, type: '핵심 힌트', title: '확인', message: '조건을 확인하세요.', severity: 'warning' }],
  );
  const serialized = JSON.stringify(response);
  assert.deepEqual(Object.keys(response).sort(), [
    'execution_time', 'feedback', 'submission_id', 'verdict',
  ]);
  for (const forbidden of ['test_results', 'expected_output', 'actual_output', 'input_data']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('단일 케이스 runner에는 tests.json이 없어 악성 제출이 기대값을 읽지 못한다', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'didim-judge-'));
  const runnerPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../sandbox/judge_runner.py',
  );

  try {
    await Promise.all([
      writeFile(path.join(workdir, 'judge_runner.py'), await readFile(runnerPath)),
      writeFile(path.join(workdir, 'input.txt'), 'public input\n'),
      writeFile(
        path.join(workdir, 'solution.py'),
        'from pathlib import Path\nprint(Path("tests.json").read_text())\n',
      ),
    ]);

    const process = spawnSync('python3', ['judge_runner.py'], {
      cwd: workdir,
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(process.status, 0, process.stderr);
    const result = JSON.parse(process.stdout);
    assert.equal(result.outcome, 'RUNTIME_ERROR');
    assert.equal(result.stdout, '');
    assert.equal(await readFile(path.join(workdir, 'input.txt'), 'utf8'), 'public input\n');
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('runner는 stdout 64KiB 초과를 중단하고 원문을 반환하지 않는다', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'didim-output-limit-'));
  const runnerPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../sandbox/judge_runner.py',
  );

  try {
    await Promise.all([
      writeFile(path.join(workdir, 'judge_runner.py'), await readFile(runnerPath)),
      writeFile(path.join(workdir, 'input.txt'), ''),
      writeFile(path.join(workdir, 'solution.py'), 'print("x" * 70000)\n'),
    ]);
    const process = spawnSync('python3', ['judge_runner.py'], {
      cwd: workdir,
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(process.status, 0, process.stderr);
    const result = JSON.parse(process.stdout);
    assert.equal(result.outcome, 'OUTPUT_LIMIT');
    assert.equal(result.stdout, '');
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('실제 runner가 CE, RE, TLE를 서로 다른 outcome으로 반환한다', async () => {
  const runnerPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../sandbox/judge_runner.py',
  );
  const cases = [
    { code: 'if True print("x")\n', outcome: 'COMPILE_ERROR' },
    { code: 'raise RuntimeError("boom")\n', outcome: 'RUNTIME_ERROR' },
    { code: 'while True:\n    pass\n', outcome: 'TIMED_OUT' },
  ];

  for (const testCase of cases) {
    const workdir = await mkdtemp(path.join(tmpdir(), 'didim-verdict-'));
    try {
      await Promise.all([
        writeFile(path.join(workdir, 'judge_runner.py'), await readFile(runnerPath)),
        writeFile(path.join(workdir, 'input.txt'), ''),
        writeFile(path.join(workdir, 'solution.py'), testCase.code),
      ]);
      const process = spawnSync('python3', ['judge_runner.py'], {
        cwd: workdir,
        encoding: 'utf8',
        timeout: 5_000,
      });
      assert.equal(process.status, 0, process.stderr);
      assert.equal(JSON.parse(process.stdout).outcome, testCase.outcome);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
});
