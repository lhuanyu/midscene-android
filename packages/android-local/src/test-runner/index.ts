/**
 * `@midscene/test` integration: run a YAML test project on the device the
 * agent is already running on.
 *
 * The public surface is deliberately small — a node set, an agent, and one
 * entry point — because everything else (parsing, lifecycle, execution,
 * reporting) belongs to `@midscene/test`.
 */
export {
  OnDeviceAndroidAgent,
  type OnDeviceAndroidAgentOpt,
} from './agent';
export {
  type LaunchNodeInput,
  type RunAdbShellNodeInput,
  type TerminateNodeInput,
  launchInputSchema,
  onDeviceAndroidNodeDefinitions,
  runAdbShellInputSchema,
  runAdbShellNode,
  runAdbShellOptionsInputSchema,
  terminateInputSchema,
} from './nodes';
export {
  type AndroidTestProjectRunResult,
  type AndroidTestProjectSummary,
  type CollectedSource,
  type RunAndroidTestProjectOptions,
  buildAndroidTestNodes,
  createRunId,
  runAndroidTestProject,
} from './run';
