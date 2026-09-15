/**
 * Android device steps for `@midscene/test` YAML.
 *
 * The shape mirrors the upstream `packages/android` node module on purpose: the
 * same node names, the same schemas, the same summaries. A YAML file written
 * against upstream's Android nodes should run here unchanged, and a reader who
 * knows one file should be able to read the other.
 *
 * The difference is *what the nodes are attached to*. Upstream binds them to an
 * `AndroidAgent`, which assumes a host computer driving the device over adb.
 * These bind to {@link OnDeviceAndroidAgent}, which drives the phone the agent
 * is already running on — there is no host.
 *
 * `runAdbShell` is deliberately **not** part of the default set. See
 * {@link runAdbShellNode} for why.
 */
import {
  type AgentTestRunnerNodeDefinition,
  createAgentTestRunnerNodeDefinition,
} from '@midscene/core/agent/test';
import { z } from 'zod/v4';
import type { OnDeviceAndroidAgent } from './agent';

type OnDeviceAndroidAgentTestRunnerApi = Pick<
  OnDeviceAndroidAgent,
  'launch' | 'terminate' | 'runAdbShell' | 'back' | 'home' | 'recentApps'
>;

const defineAndroidNode =
  createAgentTestRunnerNodeDefinition<OnDeviceAndroidAgentTestRunnerApi>(
    'an on-device Android Agent',
  );

const nonBlankText = (description: string) =>
  z
    .string()
    .regex(/\S/, 'value must contain a non-whitespace character')
    .describe(description);

export const launchInputSchema = z.strictObject({
  uri: nonBlankText('The app, URL, URI, or package name to launch.'),
});

export const terminateInputSchema = z.strictObject({
  uri: nonBlankText('The package name or app name to terminate.'),
});

export const runAdbShellOptionsInputSchema = z.strictObject({
  timeout: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Shell command timeout in milliseconds.'),
});

export const runAdbShellInputSchema = z.strictObject({
  command: nonBlankText(
    'The shell command to execute, without an adb shell prefix.',
  ),
  options: runAdbShellOptionsInputSchema.optional(),
});

const emptyInputSchema = z.strictObject({});

export type LaunchNodeInput = z.infer<typeof launchInputSchema>;
export type TerminateNodeInput = z.infer<typeof terminateInputSchema>;
export type RunAdbShellNodeInput = z.infer<typeof runAdbShellInputSchema>;

const launchNode = defineAndroidNode({
  method: 'launch',
  description: 'Launch an application through the current Android Agent.',
  stringInputKey: 'uri',
  inputSchema: launchInputSchema,
  toArgs: (input) => [input.uri],
  toResult: (_output, input) => ({ summary: `Launched ${input.uri}` }),
});

const terminateNode = defineAndroidNode({
  method: 'terminate',
  description: 'Terminate an application through the current Android Agent.',
  stringInputKey: 'uri',
  inputSchema: terminateInputSchema,
  toArgs: (input) => [input.uri],
  toResult: (_output, input) => ({ summary: `Terminated ${input.uri}` }),
});

/**
 * The shell step, kept out of the default node set.
 *
 * Every other node here operates the device the way a person can: launch, stop,
 * go back, go home. This one runs an arbitrary command as the shell user, which
 * is a strictly larger capability than "operate the UI" — it can read the
 * device, change settings and touch other apps' data.
 *
 * The project already gates the same capability for the *model*
 * (`exposeRunAdbShellAction`, default off). A YAML file is a different author
 * with a different threat model — it is usually someone else's test suite,
 * checked in and run unattended — so it gets its own switch
 * (`test.runAdbShell`) rather than sharing that one. Enabling either never
 * enables the other.
 */
export const runAdbShellNode = defineAndroidNode({
  method: 'runAdbShell',
  title: 'Run an ADB shell command',
  description:
    'Execute a shell command through the current Android Agent. Pass only the shell command, without the adb shell prefix.',
  stringInputKey: 'command',
  inputSchema: runAdbShellInputSchema,
  toArgs(input, context) {
    context.signal.throwIfAborted();
    if (/^\s*adb(?:\s|$)/i.test(input.command)) {
      throw new TypeError(
        'command must not include an adb or adb shell prefix.',
      );
    }
    return [input.command, input.options];
  },
  toResult(stdout) {
    if (typeof stdout !== 'string') {
      throw new TypeError('runAdbShell() must return stdout as a string.');
    }
    return {
      summary: `Executed ADB shell command (${stdout.length} stdout characters)`,
      data: { stdout },
    };
  },
});

const backNode = defineAndroidNode({
  method: 'back',
  description: 'Trigger the Android system back operation.',
  stringInputKey: false,
  inputSchema: emptyInputSchema,
  toArgs: () => [],
  toResult: () => ({ summary: 'Triggered Android back' }),
});

const homeNode = defineAndroidNode({
  method: 'home',
  description: 'Trigger the Android system home operation.',
  stringInputKey: false,
  inputSchema: emptyInputSchema,
  toArgs: () => [],
  toResult: () => ({ summary: 'Triggered Android home' }),
});

const recentAppsNode = defineAndroidNode({
  method: 'recentApps',
  description: 'Trigger the Android system recent apps operation.',
  stringInputKey: false,
  inputSchema: emptyInputSchema,
  toArgs: () => [],
  toResult: () => ({ summary: 'Triggered Android recentApps' }),
});

/**
 * Device steps that are always available.
 *
 * Everything here is reachable by a person holding the phone; nothing runs a
 * command or reaches outside the foreground UI.
 */
export const onDeviceAndroidNodeDefinitions: readonly AgentTestRunnerNodeDefinition[] =
  [launchNode, terminateNode, backNode, homeNode, recentAppsNode];
