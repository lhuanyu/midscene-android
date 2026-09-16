import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from '@rstest/core';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const source = transpileModule(
  fs.readFileSync(
    path.resolve(__dirname, '../../src/runner/cancellation.ts'),
    'utf8',
  ),
  {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
    },
  },
).outputText;

// Keep the parent's stdin pipe open, just like Android's ShellRunner. Testing
// only callbacks in-process misses the live handle that prevented CLI exit.
async function runChild(body: string, stop?: 'stdin' | 'signal') {
  const child = spawn(process.execPath, ['-e', `${source}\n${body}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let sent = false;
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stop && !sent && stdout.includes('ready')) {
      sent = true;
      if (stop === 'stdin') child.stdin.write('stop\n');
      else child.kill('SIGTERM');
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 5000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    expect(timedOut).toBe(false);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    child.kill('SIGKILL');
  }
}

describe('CLI cancellation lifecycle', () => {
  test('exits after success while the host keeps stdin open, flushing the result', async () => {
    const result = await runChild(`
      withRunCancellation(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        console.log(JSON.stringify({ ok: true, report: 'x'.repeat(100000) }));
      });
    `);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      report: 'x'.repeat(100000),
    });
  });

  test('exits after a run throws without requiring a stop command', async () => {
    const result = await runChild(`
      withRunCancellation(async () => { throw new Error('run failed'); })
        .catch(error => { console.error(error.message); process.exitCode = 1; });
    `);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('run failed');
  });

  for (const stop of ['stdin', 'signal'] as const) {
    test(`still finishes the report after a ${stop} stop`, async () => {
      const result = await runChild(
        `
        withRunCancellation(async signal => {
          console.log('ready');
          await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
          await new Promise(resolve => setTimeout(resolve, 20));
          console.log('report written');
        });
      `,
        stop,
      );
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('report written');
    });
  }
});
