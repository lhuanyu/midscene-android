/**
 * The agent a `@midscene/test` YAML file drives on the phone.
 *
 * It is a thin subclass on purpose. Everything the test engine needs from a
 * "Midscene agent" — `aiAct`, `aiTap`, `aiAssert`, `aiBoolean`, `aiNumber`,
 * `aiString`, `aiAsk`, `recordToReport` — is already implemented by the core
 * `Agent` this project builds for every run. What is added here is the device
 * surface the Android YAML steps call, and the node registry that advertises
 * them.
 */
import {
  type AgentTestRunnerNodeDefinition,
  Agent as CoreAgent,
} from '@midscene/core/agent';
import type { AgentOpt } from '@midscene/core/agent';
import type { LocalAndroidDevice } from '../device';
import { onDeviceAndroidNodeDefinitions } from './nodes';

/**
 * Constructor options are the core agent's, unchanged.
 *
 * Re-exported under a project-local name so callers do not have to know which
 * upstream module the type lives in.
 */
export type OnDeviceAndroidAgentOpt = AgentOpt;

export class OnDeviceAndroidAgent extends CoreAgent<LocalAndroidDevice> {
  /**
   * The node registry this agent contributes to a test project.
   *
   * Core's own nodes come first and are never overridden; the device steps are
   * additive. `runAdbShell` is not included — the runner adds it only when the
   * `test.runAdbShell` switch is on.
   */
  static override getTestRunnerNodeDefinitions(): readonly AgentTestRunnerNodeDefinition[] {
    return [
      ...CoreAgent.getTestRunnerNodeDefinitions(),
      ...onDeviceAndroidNodeDefinitions,
    ];
  }

  /** The device this agent drives. Core stores it as `interface`. */
  get device(): LocalAndroidDevice {
    return this.interface;
  }

  /** Launch an app, URL, `pkg/activity`, or a mapped friendly name. */
  async launch(uri: string): Promise<void> {
    await this.device.launch(uri);
  }

  /** Force-stop an app by package name or mapped friendly name. */
  async terminate(uri: string): Promise<void> {
    await this.device.terminate(uri);
  }

  /**
   * Run a shell command and return stdout.
   *
   * Only reachable when the runner registered {@link runAdbShellNode}, which
   * happens only when `test.runAdbShell` is enabled.
   */
  async runAdbShell(
    command: string,
    options?: { timeout?: number },
  ): Promise<string> {
    return await this.device.runAdbShell(command, {
      timeoutMs: options?.timeout,
    });
  }

  /** Press the system back key. */
  async back(): Promise<void> {
    await this.device.back();
  }

  /** Press the system home key. */
  async home(): Promise<void> {
    await this.device.home();
  }

  /** Press the system recent-apps key. */
  async recentApps(): Promise<void> {
    await this.device.recentApps();
  }
}
