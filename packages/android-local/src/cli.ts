#!/usr/bin/env node
/**
 * `midscene-local` — the deployment shell around the on-device agent.
 *
 * It runs inside the Android host app's embedded Node (the app injects the
 * bridge coordinates), or on a PC against adb. The surface is deliberately
 * small: inspect the device (`doctor`), run a task list (`run`), or run a
 * `@midscene/test` YAML project (`test`).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { loadLocalAgentConfig } from './config/schema';
import type { LocalAgentConfig } from './config/schema';
import {
  runLocalAgentConfigFile,
  runLocalAgentTestConfigFile,
} from './runner/run';
import { AdbShellTransport } from './transport/adb-shell';
import {
  ExecBridgeCommandRunner,
  bridgeFromEnv,
  createBridgeFileIo,
} from './transport/bridge';
import { ShellTransport } from './transport/shell';
import type { AndroidTransport } from './transport/types';

function readVersion(): string {
  // The CLI is bundled into dist/lib (cjs) and dist/es (esm), so the package
  // manifest sits either one or two levels up depending on the artefact.
  for (const candidate of ['../../package.json', '../package.json']) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, candidate), 'utf8'),
      ) as { version?: string };
      if (pkg.version) {
        return pkg.version;
      }
    } catch {
      // try the next location
    }
  }
  return 'unknown';
}

const USAGE = `midscene-local — on-device Android agent

Usage:
  midscene-local doctor [--backend device-bridge|adb-shell] [--serial <id>]
  midscene-local run <config.yaml|config.json>
  midscene-local test <config.yaml|config.json>
  midscene-local --version
  midscene-local --help

Commands:
  doctor   Probe the device: capabilities, health, displays and timing.
  run      Execute the config file: its task list, or — when it carries a
           test block instead of tasks — its @midscene/test project.
  test     Run the @midscene/test YAML project described by a config file.
           Identical to run on such a config; use it to be explicit.

           YAML steps are the Midscene AI steps plus the Android device steps:
           launch, terminate, back, home and recentApps. The runAdbShell step
           exists only when test.runAdbShell is true — it lets any YAML file in
           the project run shell commands as the shell user, so it is off by
           default and announced on every run that enables it.

           The unified HTML report is written to test.reportDir.

Backends:
  device-bridge        (default) On-device path. The host app injects
                       MIDSCENE_EXEC_BRIDGE_URL/TOKEN and MIDSCENE_EXEC_CHANNEL;
                       commands reach uid 2000 through whichever channel that app
                       selected (a Shizuku user service, or its own adb client).
  adb-shell            Drive the device from this host over adb.
`;

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg.startsWith('--')) {
      const [key, inlineValue] = arg.slice(2).split('=');
      const next = argv[index + 1];
      if (inlineValue !== undefined) {
        flags[key as string] = inlineValue;
      } else if (next !== undefined && !next.startsWith('--')) {
        flags[key as string] = next;
        index += 1;
      } else {
        flags[key as string] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

/**
 * Build the transport the CLI drives directly.
 *
 * `run <config>` goes through the runner, which selects its own transport, so
 * this only serves `doctor`. With no `--backend` the CLI behaves like the
 * bundled agent: it needs the host app's bridge coordinates in the environment.
 */
function createTransportFromFlags(
  flags: Record<string, string>,
): AndroidTransport {
  const backend = flags.backend ?? 'device-bridge';

  if (backend === 'adb-shell') {
    return new AdbShellTransport({
      adbPath: flags.adbPath,
      serial: flags.serial,
    });
  }

  // `shizuku-userservice` is what this route was called before the adb channel
  // existed; a config or a script that still says it means the same thing.
  if (backend !== 'device-bridge' && backend !== 'shizuku-userservice') {
    throw new Error(
      `Unknown backend "${backend}"; expected device-bridge or adb-shell`,
    );
  }

  const bridge = bridgeFromEnv();
  if (!bridge) {
    throw new Error(
      'The device-bridge backend needs the host app: it must set ' +
        'MIDSCENE_EXEC_BRIDGE_URL and MIDSCENE_EXEC_BRIDGE_TOKEN. From a PC, ' +
        'pass --backend adb-shell --serial <id> instead.',
    );
  }

  const runner = new ExecBridgeCommandRunner(bridge);
  return new ShellTransport({
    runner,
    fileIo: createBridgeFileIo(runner),
    fileChannelDir: requireFileChannelDir(
      flags['file-channel-dir'] ?? process.env.MIDSCENE_FILE_CHANNEL_DIR,
    ),
  });
}

/**
 * The file channel has no safe default: the directory must be writable by the
 * shell uid and readable by this process. A missing value used to fall back to
 * an on-device path, which fails later with an opaque EACCES.
 */
function requireFileChannelDir(value: string | undefined): string {
  if (!value) {
    throw new Error(
      'The file channel directory is required on the on-device path: pass ' +
        '--file-channel-dir <path> or set MIDSCENE_FILE_CHANNEL_DIR. It must ' +
        'be writable by the shell uid and readable by this process (the app ' +
        'uses its external files directory).',
    );
  }

  return value;
}

async function doctor(flags: Record<string, string>): Promise<number> {
  const transport = createTransportFromFlags(flags);

  try {
    const health = await transport.healthCheck();
    const capabilities = await transport.getCapabilities();
    const displays = await transport.listDisplays();

    const screenshotStartedAt = Date.now();
    const screenshot = await transport.screenshot();
    const screenshotMs = Date.now() - screenshotStartedAt;

    console.log(
      JSON.stringify(
        {
          ok: health.ok,
          backend: transport.backend,
          uid: capabilities.uid,
          privileged: capabilities.privileged,
          capabilities,
          displays: displays.map((display) => ({
            id: display.id,
            name: display.name,
            size: `${display.width}x${display.height}`,
            isDefault: display.isDefault,
            isVirtual: display.isVirtual,
          })),
          screenshot: { bytes: screenshot.length, ms: screenshotMs },
        },
        null,
        2,
      ),
    );

    await transport.close();
    return health.ok ? 0 : 1;
  } catch (error) {
    console.error(
      `doctor failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

/**
 * Stop when the host asks, without the host having to kill this process.
 *
 * The host app stops a run by signalling the child. Killing it does not work:
 * destroying a process on Android closes its pipes immediately, so the next line
 * this CLI writes fails and it dies wherever it happened to be — before it has
 * written the report and the summary, which are the two things a person wants
 * after stopping a run. A line on stdin leaves the pipes intact and lets the run
 * finish at the next step boundary.
 *
 * A terminal is not a control channel, so this only listens when stdin is a pipe.
 */
function abortOnHostRequest(controller: AbortController): void {
  const stdin = process.stdin;
  if (stdin.isTTY) {
    return;
  }

  stdin.setEncoding('utf8');
  stdin.on('data', (chunk: string) => {
    if (!chunk.includes('stop')) {
      return;
    }
    console.error(
      '[midscene-local] stop requested by the host: finishing the current step, then writing the report',
    );
    controller.abort(new Error('stopped by the host'));
  });
  stdin.resume();
  controller.signal.addEventListener(
    'abort',
    () => {
      stdin.destroy();
    },
    { once: true },
  );
}

async function run(configPath: string | undefined): Promise<number> {
  if (!configPath) {
    console.error('run requires a config file path\n');
    console.error(USAGE);
    return 2;
  }

  // Validate before touching a device so a typo fails fast.
  const config = loadLocalAgentConfig(configPath);

  /**
   * `run` executes whatever the config describes, so a shell that has a config
   * file and no YAML parser can hand it over without deciding first. The host
   * app is exactly that shell: the schema knows whether this is a task list or
   * a test project, and Java does not.
   */
  if (config.test) {
    return await runTestConfig(configPath, config);
  }

  const controller = abortOnSignal();
  abortOnHostRequest(controller);
  const result = await runLocalAgentConfigFile(configPath, {
    signal: controller.signal,
    onEvent: (event) => {
      if (event.type !== 'task') {
        console.error(`[${event.type}] ${event.message}`);
      } else {
        console.error(`[task] ${event.message}`);
      }
    },
  });

  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

/**
 * Turn a termination signal into an abort instead of an immediate death.
 *
 * The host app stops a run by killing this process, and killing it outright
 * means the run leaves no report and no summary — the two things a person most
 * wants after stopping something that was going wrong. Handling SIGTERM lets
 * the run stop at the next step boundary and still write both; the app waits a
 * moment for that and force-kills if it takes too long.
 *
 * The handlers are removed once the abort is under way, so a second signal
 * terminates immediately: a run that will not stop can still be killed.
 */
function abortOnSignal(): AbortController {
  const controller = new AbortController();
  const handler = (signal: NodeJS.Signals) => {
    console.error(
      `[midscene-local] ${signal}: stopping after the current step, then writing the report`,
    );
    controller.abort(new Error(`interrupted by ${signal}`));
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
  controller.signal.addEventListener(
    'abort',
    () => {
      process.removeListener('SIGTERM', handler);
      process.removeListener('SIGINT', handler);
    },
    { once: true },
  );
  return controller;
}

async function runTestConfig(
  configPath: string,
  config: LocalAgentConfig,
): Promise<number> {
  console.error(`[test] running the @midscene/test project in ${configPath}`);
  if (config.test?.runAdbShell) {
    console.error(
      '[test] WARNING: test.runAdbShell is on — every YAML file in this project can run shell commands on this device.',
    );
  }

  const controller = abortOnSignal();
  abortOnHostRequest(controller);
  const result = await runLocalAgentTestConfigFile(configPath, {
    signal: controller.signal,
    onProgress: (message) => console.error(message),
    /**
     * Same channel as the task runner: a `[event] {json}` line on stdout, which
     * is what the host app parses for its progress overlay. Text goes to stderr
     * so it never competes with the result JSON on stdout.
     */
    onEvent: (payload) => {
      process.stdout.write(`[event] ${JSON.stringify(payload)}\n`);
    },
  });

  console.log(JSON.stringify(result, null, 2));
  return result.status === 'success' ? 0 : 1;
}

async function runTest(configPath: string | undefined): Promise<number> {
  if (!configPath) {
    console.error('test requires a config file path\n');
    console.error(USAGE);
    return 2;
  }

  // Validate before touching a device so a typo fails fast.
  const config = loadLocalAgentConfig(configPath);
  if (!config.test) {
    console.error(
      `${configPath} has no \`test\` block; add one to run a @midscene/test project.\n`,
    );
    return 2;
  }

  return await runTestConfig(configPath, config);
}

async function main(): Promise<void> {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (flags.version === 'true' || command === '--version') {
    console.log(`midscene-local v${readVersion()} (node ${process.version})`);
    return;
  }

  if (!command || flags.help === 'true') {
    console.log(USAGE);
    process.exitCode = command ? 0 : 2;
    return;
  }

  switch (command) {
    case 'doctor':
      process.exitCode = await doctor(flags);
      return;
    case 'run':
      process.exitCode = await run(positional[1]);
      return;
    case 'test':
      process.exitCode = await runTest(positional[1]);
      return;
    default:
      console.error(`Unknown command "${command}"\n`);
      console.error(USAGE);
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
