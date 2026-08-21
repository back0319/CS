import fs from 'fs';
import path from 'path';
import { NextApiRequest, NextApiResponse } from 'next';
import { parseRunnerResult } from '../../lib/judge-contract';
import { EXECUTION_LIMITS, withSandbox } from '../../lib/sandbox-lifecycle';

export const config = {
  maxDuration: 30,
};

interface RunResponse {
  success: boolean;
  output?: string;
  error?: string;
  execution_time?: number;
}

const RUNNER = fs.readFileSync(
  path.join(process.cwd(), 'sandbox', 'judge_runner.py'),
  'utf8',
);

function publicRunError(outcome: ReturnType<typeof parseRunnerResult>['outcome'], stderr: string): string {
  switch (outcome) {
    case 'COMPILE_ERROR':
      return stderr || 'Python 구문을 확인해주세요.';
    case 'RUNTIME_ERROR':
      return stderr || '실행 중 오류가 발생했습니다.';
    case 'TIMED_OUT':
      return '실행 시간이 3초를 초과했습니다.';
    case 'OUTPUT_LIMIT':
      return '출력이 64KiB 제한을 초과했습니다.';
    case 'OK':
      return '';
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RunResponse>,
) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { code, language, input_data = '' } = req.body || {};
  const input = String(input_data);
  if (language !== 'python' || typeof code !== 'string') {
    return res.status(400).json({ success: false, error: '현재 Python만 지원됩니다.' });
  }
  if (
    code.length === 0
    || Buffer.byteLength(code, 'utf8') > EXECUTION_LIMITS.codeBytes
    || Buffer.byteLength(input, 'utf8') > EXECUTION_LIMITS.inputBytes
  ) {
    return res.status(400).json({
      success: false,
      error: '코드는 20,000바이트, 입력은 10,000바이트 이하로 작성해주세요.',
    });
  }

  try {
    const execution = await withSandbox('run', {
      budgetMs: 10_000,
      sessionTimeoutMs: 15_000,
    }, async (sandbox, signal) => {
      await sandbox.writeFiles([
        { path: 'solution.py', content: Buffer.from(code, 'utf8') },
        { path: 'input.txt', content: Buffer.from(input, 'utf8') },
        { path: 'judge_runner.py', content: Buffer.from(RUNNER, 'utf8') },
      ], { signal });
      const command = await sandbox.runCommand('python3', ['judge_runner.py'], {
        signal,
        timeoutMs: EXECUTION_LIMITS.commandMs,
      });
      const [output, error] = await Promise.all([command.stdout(), command.stderr()]);
      if (command.exitCode !== 0) {
        throw new Error(error ? 'runner_failed' : 'runner_unavailable');
      }
      return parseRunnerResult(JSON.parse(output));
    });

    return res.status(200).json({
      success: execution.outcome === 'OK',
      output: execution.stdout,
      error: publicRunError(execution.outcome, execution.stderr),
      execution_time: execution.executionTimeMs,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'sandbox_run_error',
      error: error instanceof Error ? error.name : 'UnknownError',
    }));
    return res.status(500).json({
      success: false,
      error: '격리 실행 환경을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.',
    });
  }
}
