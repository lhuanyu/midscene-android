# Contributing

Thanks for your interest. This project is a community extension built on
[Midscene](https://github.com/web-infra-dev/midscene); it is **not** an official
Midscene project.

## Scope: what will not be accepted

This project deliberately gives up certain capabilities. Pull requests and feature
requests for the following will be **closed without merging**, regardless of
implementation quality:

- **Multi-device control / bulk operations** — driving many devices from one place
- **Bulk account operations** — registration, sign-in, or account warming at scale
- **Anti-detection / evasion** — defeating bot detection, risk control, or device
  fingerprinting
- **Bypassing device security** — lock-screen bypass, privilege escalation,
  persistence, or hiding the app's presence
- **Silent operation** — any mode where a run leaves no visible, interruptible trace

These are not arbitrary: their primary uses are abuse, and they conflict directly
with the design commitments the project is built on (see below). If you need one
of these capabilities, this is not the right project — please don't spend your
time writing the patch.

## Design commitments

Changes must preserve these. They are the project's main line of legitimacy:

1. **Always visible.** A run shows an interruptible overlay. Do not add hidden modes.
2. **Local by default.** No component uploads user data to a server we operate.
3. **Credentials stay private.** Model credentials belong in app-private storage,
   never in shared storage, logs, reports, or checked-in files.
4. **No remote-control channel.** No server-side component that drives a device.
5. **Do not weaken the security model.** In particular: keep the Shizuku channel
   the default, keep the adb channel opt-in with its caveat shown in the UI, and
   do not extend what a model can do without an explicit opt-in and documentation
   (the existing `exposeRunAdbShellAction` pattern — off by default — is the model
   to follow).

## Before opening a PR

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run build
pnpm test
pnpm run test:android   # needs the Android SDK
```

In your PR description, list the commands you actually ran. If you could not run
something (an APK build needs the Android SDK and network access to the pinned
Termux packages; APK behaviour needs an arm64 device), say so explicitly rather
than implying it was verified.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) with a **required
scope**. Scopes in use:

| Scope | Applies to |
|---|---|
| `android` | `packages/android-local` (the agent runtime) |
| `host` | `apps/android-host` (the APK host) |
| `workflow` | `.github/workflows` |
| `docs` | documentation only |

Example: `fix(host): stop the progress overlay swallowing taps`

## Code standards

- **TypeScript** in `packages/android-local`: formatted and linted by Biome
  (`pnpm run lint`). Keep the public API surface deliberate — this package is
  published to npm.
- **Java/Kotlin** in `apps/android-host`: match the surrounding style. The JVM
  unit tests under `app/src/test/` must pass.
- **Shell quoting**: never interpolate an unquoted value into a shell command.
  The runtime has `quoteShellArg` for this; use it.
- **Tests**: add or update tests when behaviour changes. Start with the nearest
  unit suite; a device or a model is only needed when the change genuinely depends
  on one.
- **Do not hand-edit generated output** (`dist/`, `apps/android-host/app/build/`,
  `apps/android-host/app/src/main/assets/`).

## Documentation

User-facing docs are bilingual by default: if you edit `README.md`, update
`README.zh.md` in the same change, and keep `SECURITY.md` consistent with both.

## Security

Do not open public issues for security problems — see [SECURITY.md](./SECURITY.md).
Changes that touch the adb channel, the exec bridge, the WebView, or credential
handling should describe their security impact in the PR description.

## Licence

By contributing you agree your contributions are licensed under the MIT Licence
(see [LICENSE](./LICENSE)).
