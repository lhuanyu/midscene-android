import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { z } from 'zod';

/**
 * Configuration for an on-device local run.
 *
 * This is the file a "config manager" (CLI today, Android app later) edits and
 * hands to the runner. Everything the runner needs to reproduce a run lives
 * here, so a task can be deployed to a phone without rebuilding the agent.
 */

export const transportBackendSchema = z.enum([
  'device-bridge',
  /**
   * @deprecated The on-device route used to be called this, back when Shizuku was
   * the only thing behind it. Accepted so configs written before the rename keep
   * working; the app writes `device-bridge` now.
   */
  'shizuku-userservice',
  'adb-shell',
]);

export const localAgentDeviceSchema = z.object({
  /**
   * How commands reach the device.
   *
   * `device-bridge` is the on-device path; the host app selects it by injecting
   * the bridge environment, so the value is informational there. Which shell sits
   * behind that bridge — a Shizuku user service or the app's own adb client — is
   * reported by `doctor`, not chosen here.
   * `adb-shell` drives the device from this host instead.
   */
  backend: transportBackendSchema.default('device-bridge'),
  /** Display used for every operation; default is the device default display. */
  displayId: z.number().int().nonnegative().optional(),
  /** Directory for the on-device payload channel (backend: device-bridge). */
  fileChannelDir: z.string().optional(),
  /** adb executable (backend: adb-shell). */
  adbPath: z.string().optional(),
  /** Target serial, e.g. `emulator-5554` (backend: adb-shell). */
  serial: z.string().optional(),
  /** yadb dex used for CJK text and pinch gestures. */
  yadbPath: z.string().optional(),
  /** Friendly app name → package name mapping for Launch/Terminate. */
  appNameMapping: z.record(z.string()).optional(),
  /** Register the model-visible RunAdbShell action. Defaults to false. */
  exposeRunAdbShellAction: z.boolean().optional(),
});

export const localAgentModelSchema = z.object({
  /** Model API key. Prefer the environment or a secret store in production. */
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  name: z.string().optional(),
  family: z.string().optional(),
});

export const localAgentTaskSchema = z.object({
  name: z.string().min(1),
  /**
   * - `aiAct` / `aiAssert` / `aiQuery`: run the prompt directly;
   * - `yaml`: run a Midscene YAML script (inline `script` text or a file path).
   */
  type: z.enum(['aiAct', 'aiAssert', 'aiQuery', 'yaml']).default('aiAct'),
  prompt: z.string().optional(),
  script: z.string().optional(),
});

/**
 * A `@midscene/test` YAML project, run on this device.
 *
 * `tasks` and `test` are two ways to say what a run does: a short list of AI
 * tasks, or a real test project with cases, lifecycle hooks and a unified
 * report. A config carries one or the other.
 */
export const localAgentTestSchema = z.object({
  /** Directory holding the YAML cases, relative to the config file. */
  projectDir: z.string().default('.'),
  /** Cases to run, as globs relative to `projectDir`. Default: every YAML file. */
  include: z.array(z.string()).optional(),
  /** Unified HTML report directory, relative to the config file. */
  reportDir: z.string().default('./midscene_run/report'),
  /** Per-run summaries, relative to the config file. */
  resultDir: z.string().default('./midscene_run/test-results'),
  /**
   * Register the `runAdbShell` YAML step.
   *
   * **Defaults to false, and is deliberately separate from
   * `device.exposeRunAdbShellAction`.** That flag lets the *model* run shell
   * commands; this one lets a *YAML file* run them. A YAML file is usually
   * someone else's suite, checked in and executed unattended, so it is a
   * different decision — turning on either must never turn on the other.
   *
   * When false the step does not exist at all: a case that uses it fails to
   * collect, rather than silently doing nothing.
   */
  runAdbShell: z.boolean().default(false),
});

export const localAgentConfigSchema = z
  .object({
    /** Name shown in logs and result files. */
    name: z.string().default('midscene-local'),
    device: localAgentDeviceSchema.default({}),
    model: localAgentModelSchema.optional(),
    agent: z
      .object({
        generateReport: z.boolean().default(true),
        reportDir: z.string().optional(),
        screenshotShrinkFactor: z.number().positive().optional(),
        /** Extra AI context, applied to every task. */
        aiContexts: z.record(z.string()).optional(),
        /**
         * Send the device HOME before the first task (default true).
         *
         * The agent is often started from its own UI, and every screenshot would
         * then show that UI - the report captures the controller instead of the
         * task. Pressing HOME first moves the controller to the background; the
         * foreground service keeps the run alive.
         */
        resetToHome: z.boolean().default(true),
        /** How long to wait for the launcher after pressing HOME. */
        resetToHomeTimeoutMs: z.number().int().positive().default(8000),
        /**
         * Package that must no longer be in the foreground before the first task
         * (typically the controller app). When set, the runner keeps pressing HOME
         * until that package is gone instead of waiting for any change - some
         * devices fall back to the previous activity when no launcher is available.
         */
        controllerPackage: z.string().optional(),
      })
      .default({}),
    tasks: z.array(localAgentTaskSchema).min(1).optional(),
    test: localAgentTestSchema.optional(),
  })
  .refine(
    (config) => (config.tasks === undefined) !== (config.test === undefined),
    {
      message:
        'A config takes exactly one of `tasks` (a list of AI tasks) or `test` (a @midscene/test YAML project).',
    },
  );

export type LocalAgentConfig = z.infer<typeof localAgentConfigSchema>;
export type LocalAgentDeviceConfig = z.infer<typeof localAgentDeviceSchema>;
export type LocalAgentTask = z.infer<typeof localAgentTaskSchema>;
export type LocalAgentTestConfig = z.infer<typeof localAgentTestSchema>;

/**
 * Load a config from a YAML or JSON file. Throws with a readable message so a
 * misconfigured deployment fails immediately instead of half-running.
 */
export function loadLocalAgentConfig(configPath: string): LocalAgentConfig {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = /\.json$/i.test(absolutePath)
    ? (JSON.parse(raw) as unknown)
    : yaml.load(raw);

  const result = localAgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid config ${absolutePath}:\n${result.error.issues
        .map(
          (issue) =>
            `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
        )
        .join('\n')}`,
    );
  }

  return result.data;
}

/** Inline task scripts pass through; a path is resolved relative to the config. */
export function resolveTaskScript(
  task: LocalAgentTask,
  configPath: string,
): string {
  if (typeof task.script !== 'string') {
    throw new Error(`Task "${task.name}" of type yaml needs a script`);
  }

  const looksLikeInlineYaml =
    task.script.includes('\n') || task.script.startsWith('tasks:');
  if (looksLikeInlineYaml) {
    return task.script;
  }

  const resolved = path.resolve(
    path.dirname(path.resolve(configPath)),
    task.script,
  );
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Script referenced by task "${task.name}" not found: ${resolved}`,
    );
  }

  return fs.readFileSync(resolved, 'utf8');
}
