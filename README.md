# midscene-android

**Run AI visual automation entirely on the phone — no PC, no cloud.**

> ⚠️ **Community project.** This is a community extension built on
> [Midscene](https://github.com/web-infra-dev/midscene). It is **not an official
> Midscene project** and is not supported or endorsed by the Midscene team.
> Midscene is used as the underlying agent framework (MIT).
>
> On npm: this project is **`midscene-android` (unscoped)**. The official
> Android-related packages are **`@midscene/android` (scoped)** and the
> `@midscene/android-local` package. The scope is the boundary between official
> and community — please don't confuse them.

This project packages Midscene's visual agent together with everything it needs
to run — a Node runtime, the agent bundle, and an adb client — into a single
APK. Once installed, the phone can run automation scripts by itself:

- Give it a natural-language instruction and the agent looks at the screen and operates it
- Run YAML scripts for repeatable regression checks
- Inference stays on-device (you configure the model endpoint); **no data is uploaded to any third-party server we operate**

```text
natural language / YAML ──► on-device agent ──► screen understanding ──► device control
                                   ▲
                          model endpoint (yours)
```

## Why on-device

| | On-device (this project) | Cloud / device farm |
|---|---|---|
| Where your data goes | **Stays on the device** (only model requests go to the endpoint you configure) | Screenshots uploaded to a third party |
| Visibility | **An overlay is visible for the whole run, interruptible at any time** | Runs remotely; nobody in front of the phone knows |
| Needs a computer | **No** | Yes (or a hosted service) |
| Debugging | Logs and reports on the phone | Round trips to the cloud |

**Design commitments (not just features)**

- **Always visible** — a run shows an interruptible progress overlay. This project does not do hidden runs.
- **Local by default** — we operate no servers. Model requests go straight to the endpoint you configure.
- **Credentials stay private** — model credentials live in the app's private storage, never in shared storage.
- **Traceable runtime** — the native runtime (Node, adb) comes from pinned packages verified by SHA-256.

## Install

Download `midscene-android-<version>-build<n>-<timestamp>.apk` from the
[Releases](https://github.com/lhuanyu/midscene-android/releases) page.

Verify the download — **recommended**, because this app can operate your phone:

```bash
# Check the digest
sha256sum -c SHA256SUMS

# Check the signing certificate fingerprint against the value published in the release notes
apksigner verify --print-certs midscene-android-*.apk
```

Requirements: **arm64**, Android 10+ (the app targets `minSdk 29`). Pairing over
wireless debugging needs Android 11+.

## First run

1. Open Midscene and follow the setup screen to configure a shell channel (see below)
2. In **Settings**, set the model Base URL, API Key and model name
3. In **Run**, type an instruction — or open **Scripts** to edit and run a YAML config
4. In **History**, inspect reports and logs (up to 50 runs / 300 MB are retained)

## Shell channels

The agent needs shell privileges to operate the system UI. There are two
channels; **Shizuku is recommended**:

| Channel | Setup | Notes |
|---|---|---|
| **Shizuku (recommended)** | Install and start Shizuku, then authorize Midscene | Authorization is explicit and per-app auditable. **No network listener is left running.** |
| This device (adb) | Enable wireless debugging and pair in the app | No second app required; but it runs an adb server on the device that is reachable from **other apps on the same device**. Use it only on a device you trust. |

> Trust boundary of the adb channel: it runs an adb server on the device and talks
> to it over loopback, and adb's host protocol has **no client authentication**.
> Other apps on the same device could therefore use that channel in principle.
> **If you do not fully trust the other apps on the device, use the Shizuku channel.**
> See [SECURITY.md](./SECURITY.md).

## Build from source

Prerequisites: the Node and pnpm versions from the root `package.json`, JDK 17,
Android SDK platform 35, Python 3, `zip`, `curl`, and `tar` (or `ar` on platforms
whose `tar` cannot read Debian archives).

```bash
pnpm install --frozen-lockfile
pnpm run assemble                                  # -> apps/android-host/app/build/outputs/apk/debug/app-debug.apk
pnpm --dir apps/android-host run install:apk       # adb install onto a connected device
```

> The install script is named `install:apk`, not `install`, because npm and pnpm
> treat a script literally named `install` as a lifecycle hook and would run it —
> and fail — on every `pnpm install`.

`assemble` builds the workspace package, downloads the pinned arm64 Node and adb
packages from Termux (verified by SHA-256, cached in the git-ignored
`apps/android-host/.cache/`), builds the JS bundle, and runs Gradle. The APK it
produces is a **debug** build — see below for release builds.

## Release builds and signing

A release APK must use an explicit signing key:

```bash
MIDSCENE_KEYSTORE=... MIDSCENE_KEYSTORE_PASSWORD=... \
MIDSCENE_KEY_ALIAS=... MIDSCENE_KEY_PASSWORD=... \
pnpm run assemble:release
pnpm --dir apps/android-host dist:release   # -> apps/android-host/dist/midscene-android-<version>-build<n>-<ts>.apk
```

The same four values can live in the git-ignored
`apps/android-host/local-signing.properties` (the environment takes precedence).
**Keep the signing key and its password outside the repository.**
Debug and release signatures differ, so replacing a debug installation with a
release one requires uninstalling first — which also clears the stored
credentials and the pairing key.

For a local test key, `apps/android-host/scripts/make-release-keystore.sh`
creates a git-ignored keystore using the same environment variables.

## Tests

```bash
pnpm run build        # build the agent runtime package
pnpm test             # device-runtime unit tests (200+ cases, no device needed)
pnpm run test:android # Android JVM unit tests (15 test classes), needs the Android SDK
pnpm run lint         # Biome
```

APK behaviour has to be checked on an arm64 device or emulator; model-backed runs
need configured model credentials.

## Known limitations

- Model credentials are stored **in plaintext** in the app's private `model.env`.
  **Do not use a production API key on a device you do not trust.**
- arm64 only; `minSdk 29`.
- Wireless debugging may need to be re-enabled after a reboot.
- The bundled adb client and Node runtime are prebuilt third-party arm64 packages
  (from Termux), pinned and verified by SHA-256. See [SECURITY.md](./SECURITY.md).

## What this project will not do

The following capabilities are **deliberately out of scope**; feature requests
for them will not be accepted:

- multi-device control / bulk operations
- bulk account operations (registration, sign-in, account warming)
- anti-detection, risk-control evasion, or device-fingerprint spoofing
- bypassing device security (lock screen, privilege escalation, persistence)
- any form of silent or hidden operation

The reason is straightforward: the main uses of those capabilities are abuse,
and they fundamentally conflict with the "always visible, fully local" design
commitments. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT, same as [Midscene](https://github.com/web-infra-dev/midscene).
This project uses Midscene as a dependency but is **not an official project**.
