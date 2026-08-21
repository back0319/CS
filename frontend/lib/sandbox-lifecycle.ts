import { Sandbox } from '@vercel/sandbox';

export const EXECUTION_LIMITS = {
  codeBytes: 20_000,
  inputBytes: 10_000,
  outputBytes: 64 * 1024,
  traceBytes: 512 * 1024,
  commandMs: 3_500,
  cleanupMs: 5_000,
} as const;

interface SandboxCommandResult {
  exitCode: number;
  durationMs?: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

export interface SandboxInstance {
  readonly name: string;
  writeFiles(
    files: Array<{ path: string; content: string | Uint8Array; mode?: number }>,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  runCommand(
    command: string,
    args?: string[],
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<SandboxCommandResult>;
  readFileToBuffer(
    file: { path: string; cwd?: string },
    options?: { signal?: AbortSignal },
  ): Promise<Buffer | null>;
  stop(options?: { signal?: AbortSignal }): Promise<unknown>;
}

interface CreateSandboxOptions {
  runtime: 'python3.13';
  timeout: number;
  persistent: false;
  networkPolicy: 'deny-all';
  signal: AbortSignal;
  tags: Record<string, string>;
}

export interface SandboxDependencies {
  createSandbox(options: CreateSandboxOptions): Promise<SandboxInstance>;
  log(entry: Record<string, unknown>): void;
}

const defaultDependencies: SandboxDependencies = {
  createSandbox: (options) => Sandbox.create({
    runtime: options.runtime,
    timeout: options.timeout,
    persistent: options.persistent,
    networkPolicy: options.networkPolicy,
    signal: options.signal,
    tags: options.tags,
  }),
  log: (entry) => console.error(JSON.stringify(entry)),
};

export async function withSandbox<T>(
  operation: 'run' | 'judge' | 'visualize',
  options: { budgetMs: number; sessionTimeoutMs: number },
  execute: (sandbox: SandboxInstance, signal: AbortSignal) => Promise<T>,
  dependencies: SandboxDependencies = defaultDependencies,
): Promise<T> {
  const signal = AbortSignal.timeout(options.budgetMs);
  let sandbox: SandboxInstance | undefined;

  try {
    sandbox = await dependencies.createSandbox({
      runtime: 'python3.13',
      timeout: options.sessionTimeoutMs,
      persistent: false,
      networkPolicy: 'deny-all',
      signal,
      tags: { didim_operation: operation },
    });
    return await execute(sandbox, signal);
  } finally {
    if (sandbox) {
      try {
        await sandbox.stop({ signal: AbortSignal.timeout(EXECUTION_LIMITS.cleanupMs) });
      } catch (error) {
        dependencies.log({
          event: 'sandbox_cleanup_failed',
          operation,
          sandbox: sandbox.name,
          error: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
  }
}
