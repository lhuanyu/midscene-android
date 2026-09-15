# midscene-android

Android device control for a Midscene agent running on the device. The package
provides a `LocalAndroidDevice`, a transport for commands executed with shell
privileges, an ADB transport for development, and a YAML-driven runner. It is
bundled into the [Android host app](../../apps/android-host/README.md).

> This is a community project. It is **not** an official Midscene package, and it
> is not the same thing as the official `@midscene/android-local`. It depends on
> published `@midscene/core`, `@midscene/shared` and `@midscene/test`.

The host app runs Node inside the APK and obtains shell access through either a
Shizuku UserService or the device's wireless-debugging `adbd`. Neither path
requires a PC during a run. Initial provisioning still needs a Node runtime and
an ADB client; see the host app's build instructions. The ADB transport in this
package also supports a PC connected to a device for debugging.

## Use the device API

```ts
import { Agent } from '@midscene/core/agent';
import {
  AdbShellTransport,
  LocalAndroidDevice,
} from 'midscene-android';

const transport = new AdbShellTransport({ serial: 'emulator-5554' });
const device = await LocalAndroidDevice.create(transport, { displayId: 0 });

try {
  const agent = new Agent(device, { generateReport: false });
  await agent.aiAct('open Settings');
} finally {
  await transport.close();
}
```

For the on-device channel, the host app supplies an `ExecBridgeCommandRunner`
and file I/O to `ShellTransport`. The transport does not start or authorize
Shizuku itself. Unsupported operations raise `AndroidTransportError` with a
machine-readable code.

## Run a config

```bash
midscene-local doctor --backend adb-shell --serial <device-id>
midscene-local run examples/local-agent.config.yaml
```

The host app invokes the same runner with its own bridge settings. Keep model
credentials in the environment or the host app's private credential file, not
in a checked-in YAML config. See the [host app guide](../../apps/android-host/README.md)
for the on-device setup.

## Run a `@midscene/test` project

`run` executes a short list of AI tasks. `test` executes a full
[`@midscene/test`](https://www.npmjs.com/package/@midscene/test) YAML project —
cases, tags, lifecycle hooks, and one unified HTML report:

```bash
midscene-local test examples/on-device-tests/agent.yaml
```

A config carries **exactly one** of `tasks` (for `run`) or `test` (for `test`):

```yaml
name: on-device-tests
device:
  backend: adb-shell
test:
  projectDir: .
  include: ['flows/**/*.yaml']
  reportDir: ./midscene_run/report
  resultDir: ./midscene_run/test-results
  runAdbShell: false
```

Each YAML step is a registered node. Besides the Midscene AI steps (`aiAct`,
`aiAssert`, `aiTap`, `wait`, ...), this package contributes the device steps a
person could perform on the phone:

| Node | Input | Meaning |
|---|---|---|
| `launch` | `uri` | Start an app, URL, `pkg/activity`, or a mapped name |
| `terminate` | `uri` | Force-stop an app |
| `back` / `home` / `recentApps` | — | System keys |
| `runAdbShell` | `command` | Shell command — **only when `test.runAdbShell` is true** |

Platform nodes (`browser.*`, `page.*`, `computer.*`) are never registered: this
runner builds its registry from the agent, so there is nothing web- or
desktop-shaped to filter out.

### The `runAdbShell` switch

`runAdbShell` lets **any** YAML file in the project run arbitrary shell commands
as the shell user. A YAML file is usually someone else's suite, checked in and
executed unattended, so it is off by default and gated **separately** from
`device.exposeRunAdbShellAction` — that flag lets the *model* run shell
commands. Enabling either never enables the other.

While the switch is off the node is not registered at all, so a case that uses
it fails to collect and names the unknown node, rather than silently skipping.
While it is on, every run prints a warning.

### Why not the `midscene-test` CLI

The upstream CLI loads its project config with `tsx`, which needs esbuild's
platform binary. Android 10+ refuses to execute a binary from an app's writable
data directory — the same constraint that makes this project ship Node and adb
as `jniLibs` `.so` files. This runner therefore drives the same engine
(`collectWorkflowDocument` / `runWorkflowDocument`) and the same report mapper
(`buildTestRunReportDump` + `TestRunReportAssembler`) directly, and the app
supplies the node registry instead of a `.ts` config on disk.

### One agent per case

Each case attempt gets its own agent, and therefore its own Midscene report
file. That is not tidiness — the unified report refuses to assemble at all if
two scopes share one agent report (`Agent report source is shared by multiple
test scopes`), so a run-wide agent works for a one-case project and fails for
every other one.

Those per-case reports are intermediate: the unified report embeds the
screenshots and model usage it needs from them, and the host app's history
pruning removes the files afterwards. The unified report is self-contained.

Not yet implemented, because a phone run owns the device for its whole duration
and has nothing for a project hook to acquire: project-level `setup`/teardown,
tag selection, retries, concurrency and bail.

## Validate

```bash
pnpm run build   # from the repository root
pnpm test        # from the repository root
```

The unit tests use fake command runners and do not require a device. A full APK
build and its Android unit tests are documented in the
[host app README](../../apps/android-host/README.md).
