import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node's type-stripping runner requires the explicit .ts extension.
import { withSandbox, type SandboxDependencies, type SandboxInstance } from './sandbox-lifecycle.ts';

function fakeSandbox(stop: () => Promise<unknown>): SandboxInstance {
  return {
    name: 'sbx-test',
    writeFiles: async () => undefined,
    runCommand: async () => ({
      exitCode: 0,
      durationMs: 1,
      stdout: async () => '',
      stderr: async () => '',
    }),
    readFileToBuffer: async () => null,
    stop,
  };
}

test('정상 실행 뒤 sandbox를 한 번 종료한다', async () => {
  let stops = 0;
  const dependencies: SandboxDependencies = {
    createSandbox: async () => fakeSandbox(async () => { stops += 1; }),
    log: () => undefined,
  };
  const value = await withSandbox(
    'run',
    { budgetMs: 1_000, sessionTimeoutMs: 2_000 },
    async () => 'ok',
    dependencies,
  );
  assert.equal(value, 'ok');
  assert.equal(stops, 1);
});

test('write/run 단계가 실패해도 sandbox 종료를 시도한다', async () => {
  let stops = 0;
  const dependencies: SandboxDependencies = {
    createSandbox: async () => fakeSandbox(async () => { stops += 1; }),
    log: () => undefined,
  };
  await assert.rejects(
    withSandbox(
      'judge',
      { budgetMs: 1_000, sessionTimeoutMs: 2_000 },
      async () => { throw new Error('run failed'); },
      dependencies,
    ),
    /run failed/,
  );
  assert.equal(stops, 1);
});

test('생성 실패 시 stop을 호출하지 않고 원래 오류를 보존한다', async () => {
  const dependencies: SandboxDependencies = {
    createSandbox: async () => { throw new Error('create failed'); },
    log: () => undefined,
  };
  await assert.rejects(
    withSandbox(
      'visualize',
      { budgetMs: 1_000, sessionTimeoutMs: 2_000 },
      async () => undefined,
      dependencies,
    ),
    /create failed/,
  );
});

test('cleanup 실패는 식별 가능한 구조화 로그로 남기고 성공 결과를 보존한다', async () => {
  const logs: Array<Record<string, unknown>> = [];
  const dependencies: SandboxDependencies = {
    createSandbox: async () => fakeSandbox(async () => { throw new Error('stop failed'); }),
    log: (entry) => logs.push(entry),
  };
  const value = await withSandbox(
    'judge',
    { budgetMs: 1_000, sessionTimeoutMs: 2_000 },
    async () => 42,
    dependencies,
  );
  assert.equal(value, 42);
  assert.deepEqual(logs, [{
    event: 'sandbox_cleanup_failed',
    operation: 'judge',
    sandbox: 'sbx-test',
    error: 'Error',
  }]);
});
