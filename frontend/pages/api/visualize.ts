import fs from 'fs';
import path from 'path';
import { NextApiRequest, NextApiResponse } from 'next';
import { EXECUTION_LIMITS, withSandbox } from '../../lib/sandbox-lifecycle';
import { parseVisualizationData } from '../../lib/visualization-contract';

export const config = {
  maxDuration: 30,
};

const RUNNER = fs.readFileSync(
  path.join(process.cwd(), 'sandbox', 'visualize_runner.py'),
  'utf8',
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { code, language, input_data = '' } = req.body || {};
  if (language !== 'python' || typeof code !== 'string') {
    return res.status(400).json({ message: '현재 Python만 지원됩니다.' });
  }

  const input = String(input_data);
  if (
    code.length === 0
    || Buffer.byteLength(code, 'utf8') > EXECUTION_LIMITS.codeBytes
    || Buffer.byteLength(input, 'utf8') > EXECUTION_LIMITS.inputBytes
  ) {
    return res.status(400).json({
      message: '코드는 20,000자, 입력은 10,000자 이하로 작성해주세요.',
    });
  }

  try {
    const trace = await withSandbox('visualize', {
      budgetMs: 12_000,
      sessionTimeoutMs: 15_000,
    }, async (sandbox, signal) => {
      await sandbox.writeFiles([
        { path: 'request.json', content: Buffer.from(JSON.stringify({ code, input_data: input }), 'utf8') },
        { path: 'visualize_runner.py', content: Buffer.from(RUNNER, 'utf8') },
      ], { signal });

      const command = await sandbox.runCommand('python3', ['visualize_runner.py'], {
        signal,
        timeoutMs: 10_000,
      });
      if (command.exitCode !== 0) {
        throw new Error('visualization_runner_failed');
      }
      const traceFile = await sandbox.readFileToBuffer({ path: 'trace.json' }, { signal });
      if (!traceFile) {
        throw new Error('visualization_trace_missing');
      }
      if (traceFile.byteLength > EXECUTION_LIMITS.traceBytes) {
        throw new Error('visualization_trace_too_large');
      }
      return parseVisualizationData(JSON.parse(traceFile.toString('utf8')));
    });

    return res.status(200).json(trace);
  } catch (error) {
    console.error('Visualization sandbox error:', error instanceof Error ? error.message : String(error));
    return res.status(500).json({
      message: '격리 실행 환경을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.',
    });
  }
}
