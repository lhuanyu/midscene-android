import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeRegistry, collectWorkflowDocument } from '@midscene/test';
import { afterEach, describe, expect, test } from '@rstest/core';
import yaml from 'js-yaml';

import { localAgentConfigSchema } from '../../src/config/schema';
import {
  type OnDeviceAndroidAgent,
  buildAndroidTestNodes,
  runAndroidTestProject,
} from '../../src/test-runner';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'midscene-android-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * A stand-in for the real agent.
 *
 * The node layer only ever calls methods on whatever `getAgent` returns, so a
 * recording object exercises the whole path — registry, YAML parsing, engine,
 * report — without a device. That is the point: the integration is what is
 * under test here, not the transport.
 */
function createStubAgent(options: { reportPath?: string } = {}) {
  const calls: string[] = [];
  const stats = { reportFlushes: 0, destroys: 0 };
  const agent = {
    /**
     * The parts of `CoreAgent` the runner reads to link the unified report back
     * to the agent's own report. `OnDeviceAndroidAgent` always has these; the
     * stub has to mirror them or it is not standing in for the real thing.
     */
    reportFile: options.reportPath,
    async destroy() {
      stats.destroys += 1;
    },
    writeOutActionDumps() {
      // Counted separately: `calls` records the operations a case performs, and
      // several tests assert that sequence exactly.
      stats.reportFlushes += 1;
    },
    async aiAct(prompt: string) {
      calls.push(`aiAct:${prompt}`);
    },
    async aiAssert(prompt: string) {
      calls.push(`aiAssert:${prompt}`);
      if (prompt.includes('FAIL')) {
        throw new Error('assertion failed on purpose');
      }
    },
    async aiBoolean() {
      return true;
    },
    async aiNumber() {
      return 0;
    },
    async aiString() {
      return 'stub';
    },
    async aiAsk() {
      return 'stub';
    },
    async aiTap(prompt: string) {
      calls.push(`aiTap:${prompt}`);
    },
    async recordToReport() {
      calls.push('recordToReport');
    },
    async launch(uri: string) {
      calls.push(`launch:${uri}`);
    },
    async terminate(uri: string) {
      calls.push(`terminate:${uri}`);
    },
    async back() {
      calls.push('back');
    },
    async home() {
      calls.push('home');
    },
    async recentApps() {
      calls.push('recentApps');
    },
    async runAdbShell(command: string) {
      calls.push(`runAdbShell:${command}`);
      return 'shell-output';
    },
  };

  return { agent: agent as unknown as OnDeviceAndroidAgent, calls, stats };
}

function writeProject(files: Record<string, string>): string {
  const root = createTempDir();
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf8');
  }
  return root;
}

function nodeNames(runAdbShell: boolean): string[] {
  const { agent } = createStubAgent();
  return buildAndroidTestNodes({
    createAgent: () => agent,
    runAdbShell,
  }).map((node) => node.name);
}

describe('test config schema', () => {
  test('accepts a test block and defaults the shell switch to off', () => {
    const config = localAgentConfigSchema.parse({
      name: 'phone-tests',
      test: {},
    });

    expect(config.test?.runAdbShell).toBe(false);
    expect(config.test?.projectDir).toBe('.');
    expect(config.tasks).toBeUndefined();
  });

  test('carries an explicit shell switch through', () => {
    const config = localAgentConfigSchema.parse({
      test: { runAdbShell: true },
    });

    expect(config.test?.runAdbShell).toBe(true);
  });

  test('rejects a config that carries both tasks and test', () => {
    const result = localAgentConfigSchema.safeParse({
      tasks: [{ name: 'x', prompt: 'y' }],
      test: {},
    });

    expect(result.success).toBe(false);
  });

  test('rejects a config that carries neither', () => {
    expect(localAgentConfigSchema.safeParse({}).success).toBe(false);
  });
});

describe('android test-runner node set', () => {
  test('always registers the device steps a person could perform', () => {
    const names = nodeNames(false);

    for (const expected of [
      'launch',
      'terminate',
      'back',
      'home',
      'recentApps',
    ]) {
      expect(names).toContain(expected);
    }
  });

  test('keeps runAdbShell out of the default set', () => {
    expect(nodeNames(false)).not.toContain('runAdbShell');
  });

  test('registers runAdbShell only when its own switch is on', () => {
    expect(nodeNames(true)).toContain('runAdbShell');
  });

  test('always registers the Midscene AI steps', () => {
    const names = nodeNames(false);

    for (const expected of ['aiAct', 'aiAssert', 'aiTap', 'wait']) {
      expect(names).toContain(expected);
    }
  });
});

describe('running an on-device test project', () => {
  test('executes device steps and AI steps from one YAML document', async () => {
    const root = writeProject({
      'flows/login.yaml': [
        'cases:',
        '  - name: open and check',
        '    steps:',
        '      - launch: com.example.app',
        '      - aiAct: tap the login button',
        '      - back: {}',
        '      - home: {}',
        '',
      ].join('\n'),
    });
    const { agent, calls } = createStubAgent();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
    });

    expect(result.status).toBe('success');
    expect(result.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(calls).toEqual([
      'launch:com.example.app',
      'aiAct:tap the login button',
      'back',
      'home',
    ]);
    expect(fs.existsSync(result.summaryPath)).toBe(true);
  });

  test('refuses runAdbShell while the switch is off', async () => {
    const root = writeProject({
      'flows/shell.yaml': [
        'cases:',
        '  - name: shell',
        '    steps:',
        '      - runAdbShell: dumpsys battery',
        '',
      ].join('\n'),
    });
    const { agent, calls } = createStubAgent();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
    });

    // The step never reaches the device; the document fails to collect.
    expect(calls).toEqual([]);
    expect(result.status).toBe('failed');
    expect(result.summary.collectionErrors).toBe(1);
  });

  test('runs runAdbShell when the switch is on', async () => {
    const root = writeProject({
      'flows/shell.yaml': [
        'cases:',
        '  - name: shell',
        '    steps:',
        '      - runAdbShell: dumpsys battery',
        '',
      ].join('\n'),
    });
    const { agent, calls } = createStubAgent();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
      runAdbShell: true,
    });

    expect(result.status).toBe('success');
    expect(calls).toEqual(['runAdbShell:dumpsys battery']);
  });

  test('reports a failing assertion as a failed case', async () => {
    const root = writeProject({
      'flows/fail.yaml': [
        'cases:',
        '  - name: fails',
        '    steps:',
        '      - aiAssert: FAIL this one',
        '',
      ].join('\n'),
    });
    const { agent } = createStubAgent();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
    });

    expect(result.status).toBe('failed');
    expect(result.summary).toMatchObject({ total: 1, passed: 0, failed: 1 });
    expect(result.cases[0]?.status).toBe('failed');
  });

  test('writes the unified Midscene Test report', async () => {
    const root = writeProject({
      'flows/one.yaml': [
        'cases:',
        '  - name: one',
        '    steps:',
        '      - launch: com.example.app',
        '',
      ].join('\n'),
    });
    const { agent } = createStubAgent();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
    });

    expect(result.reportPath).toBeTruthy();
    expect(fs.existsSync(result.reportPath as string)).toBe(true);
  });

  test('keeps going when one document will not parse', async () => {
    const root = writeProject({
      'flows/broken.yaml': 'cases: [ this is not valid\n',
      'flows/good.yaml': [
        'cases:',
        '  - name: good',
        '    steps:',
        '      - launch: com.example.app',
        '',
      ].join('\n'),
    });
    const { agent, calls } = createStubAgent();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
    });

    expect(calls).toEqual(['launch:com.example.app']);
    expect(result.summary.collectionErrors).toBe(1);
    expect(result.status).toBe('failed');
  });

  test('honours the include list', async () => {
    const root = writeProject({
      'keep/a.yaml': [
        'cases:',
        '  - name: kept',
        '    steps:',
        '      - home: {}',
        '',
      ].join('\n'),
      'skip/b.yaml': [
        'cases:',
        '  - name: skipped',
        '    steps:',
        '      - back: {}',
        '',
      ].join('\n'),
    });
    const { agent, calls } = createStubAgent();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
      include: ['keep/**/*.yaml'],
    });

    expect(calls).toEqual(['home']);
    expect(result.summary.total).toBe(1);
  });

  test('links each case to the agent report so step detail resolves', async () => {
    const root = writeProject({
      'flows/a.yaml': [
        'cases:',
        '  - name: one',
        '    steps:',
        '      - aiAct: do something',
        '',
      ].join('\n'),
    });
    // A stand-in for the Midscene report the agent writes.
    const agentReport = path.join(root, 'agent-report.html');
    fs.writeFileSync(agentReport, '<html>agent</html>', 'utf8');
    const { agent, stats } = createStubAgent({ reportPath: agentReport });

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
    });

    // Without a reportPath the unified report shows the right pass/fail counts
    // but every step reads "detail could not be resolved" and reports 0 model
    // calls, which is what this shipped first.
    //
    // The agent is destroyed to finalize its report, which is also what proves
    // the agents are per case: a run-wide agent would hand the same file to
    // every scope and the assembler refuses to assemble at all.
    expect(stats.destroys).toBe(1);
    expect(result.cases[0]?.run?.reportPaths).toEqual([agentReport]);
  });

  test('gives every case its own agent, so no two share a report', async () => {
    const root = writeProject({
      'flows/a.yaml': [
        'cases:',
        '  - name: one',
        '    steps:',
        '      - aiAct: first',
        '  - name: two',
        '    steps:',
        '      - aiAct: second',
        '',
      ].join('\n'),
    });
    const reportPaths = ['one', 'two'].map((name) => {
      const file = path.join(root, `agent-${name}.html`);
      fs.writeFileSync(file, `<html>${name}</html>`, 'utf8');
      return file;
    });
    let created = 0;

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      // A fresh agent — and therefore a fresh report file — per case.
      createAgent: () => {
        const agent = createStubAgent({
          reportPath: reportPaths[created] as string,
        }).agent;
        created += 1;
        return agent;
      },
    });

    expect(created).toBe(2);
    expect(result.cases.map((item) => item.run?.reportPaths?.[0])).toEqual(
      reportPaths,
    );
  });

  test('emits the same progress events the task runner does', async () => {
    const root = writeProject({
      'flows/a.yaml': [
        'cases:',
        '  - name: first',
        '    steps:',
        '      - launch: com.example.app',
        '  - name: second',
        '    steps:',
        '      - back: {}',
        '',
      ].join('\n'),
    });
    const { agent } = createStubAgent();
    const events: Record<string, unknown>[] = [];

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
      onEvent: (payload) => events.push(payload),
    });

    // The host app's overlay reads exactly these names.
    const names = events.map((event) => event.event);
    expect(names).toContain('run.start');
    expect(names).toContain('step.start');
    expect(names).toContain('step.end');
    expect(names).toContain('run.end');

    // The total has to be known before the first case runs, or the overlay
    // cannot show "2/5" while it matters.
    const start = events.find((event) => event.event === 'run.start');
    expect(start?.total).toBe(2);
    expect(result.summary.total).toBe(2);

    const end = events.find((event) => event.event === 'run.end');
    expect(end?.status).toBe('ok');
    expect(end?.failed).toBe(0);
  });

  test('reports a failed case through the run.end event', async () => {
    const root = writeProject({
      'flows/fail.yaml': [
        'cases:',
        '  - name: fails',
        '    steps:',
        '      - aiAssert: FAIL this one',
        '',
      ].join('\n'),
    });
    const { agent } = createStubAgent();
    const events: Record<string, unknown>[] = [];

    await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
      onEvent: (payload) => events.push(payload),
    });

    const end = events.find((event) => event.event === 'run.end');
    expect(end?.status).toBe('error');
    expect(end?.failed).toBe(1);
  });
});

/**
 * The example project ships to users, and a broken one is invisible until
 * someone runs it: a YAML syntax error, a duplicate key or a misspelled node
 * only surfaces as a collection error at run time. This collects every document
 * in the checked-in example against the real node registry, so a broken example
 * fails here instead.
 */
describe('the shipped example project', () => {
  const exampleRoot = path.resolve(process.cwd(), 'examples/on-device-tests');

  function exampleYamlFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
        } else if (/\.ya?ml$/i.test(entry.name)) {
          found.push(absolute);
        }
      }
    };
    walk(root);
    return found.sort();
  }

  test('exists with both a config and at least one case file', () => {
    expect(fs.existsSync(path.join(exampleRoot, 'agent.yaml'))).toBe(true);
    // The config itself is not a case file; the cases live under flows/.
    const caseFiles = exampleYamlFiles(path.join(exampleRoot, 'flows'));
    expect(caseFiles.length).toBeGreaterThan(0);
  });

  test('validates against the config schema, with the shell step off', () => {
    // Only the YAML parser and the schema — no device, no model.
    const raw = fs.readFileSync(path.join(exampleRoot, 'agent.yaml'), 'utf8');
    const parsed = localAgentConfigSchema.safeParse(yaml.load(raw));

    expect(parsed.success).toBe(true);
    // The example must not ship with the shell step enabled.
    expect(parsed.data?.test?.runAdbShell).toBe(false);
  });

  test('every case file collects against the real node set', () => {
    const { agent } = createStubAgent();
    const registry = new NodeRegistry(
      buildAndroidTestNodes({ createAgent: () => agent }),
    );

    const files = exampleYamlFiles(path.join(exampleRoot, 'flows'));
    expect(files.length).toBeGreaterThan(0);

    // A syntax error, a duplicate key or a misspelled node all land here.
    for (const absolutePath of files) {
      const sourcePath = path.relative(exampleRoot, absolutePath);
      expect(() =>
        collectWorkflowDocument(
          {
            projectId: 'example',
            projectName: 'example',
            sourcePath,
            absolutePath,
          },
          {
            resolveNode: (name) =>
              registry.get(name) as ReturnType<typeof registry.get>,
          },
        ),
      ).not.toThrow();
    }
  });
});

/**
 * Stopping a run is how you look at what it did, so a stopped run has to leave
 * something to look at.
 *
 * This asserts the property, not the fix: measured against the code it was
 * written for, it passes either way, because the engine takes its tidy abort
 * path in this synthetic case. The failure it came from only reproduces when a
 * real agent call is in flight and the host kills the process, which is a device
 * observation, not something this harness can stage. Keep it as a statement of
 * the requirement; do not read it as a guard on the abort handling.
 */
describe('stopping a run part way', () => {
  test('still writes the report and the result file', async () => {
    const root = writeProject({
      'flows/a.yaml': [
        'cases:',
        '  - name: first',
        '    steps:',
        '      - aiAct: do something',
        '  - name: second',
        '    steps:',
        '      - aiAct: never reached',
        '',
      ].join('\n'),
    });
    const { agent } = createStubAgent();
    const controller = new AbortController();

    const result = await runAndroidTestProject({
      projectRoot: root,
      reportDir: path.join(root, 'report'),
      resultDir: path.join(root, 'results'),
      createAgent: () => agent,
      signal: controller.signal,
      // Abort with a step in flight, which is what a person pressing stop
      // mid-run produces. Aborting between steps takes the engine's tidy path
      // and proves nothing; during one, it throws, and that is the case that
      // used to lose the report.
      onEvent: (payload) => {
        if (payload.event === 'action' && payload.tip?.includes('aiAct')) {
          controller.abort(new Error('stopped by the host'));
        }
      },
    });

    expect(result.status).toBe('failed');
    expect(fs.existsSync(result.summaryPath)).toBe(true);
    expect(result.reportPath).toBeTruthy();
    expect(fs.existsSync(result.reportPath as string)).toBe(true);
  });
});
