# Security Policy

This app can **operate your device on your behalf**, so its security model should
be stated plainly rather than buried in the code. This document describes where
the trust boundaries are, which weaknesses are known, and how to report new ones.

## Reporting a vulnerability

- **Please do not report security issues in a public issue.** Use GitHub's
  [private vulnerability reporting](../../security/advisories/new) (Security tab).
- We aim to acknowledge within **7 days** and to ship a fix or mitigation within
  **90 days**.
- Please do not disclose details publicly before a fix is released. We will not
  pursue legal action against good-faith security research.

## Threat model

### Trust boundaries

The app assumes it is installed and used by **the person using the device**, and
that other applications on the device are not fully trusted.

| Asset | Location | Protection |
|---|---|---|
| Model API key | app-private `files/model.env` | App-private storage + `allowBackup="false"` |
| adb pairing key | app-private `files/adb-home/.android/adbkey` | Same; removed on uninstall |
| Run reports / screenshots | app-private storage plus the report directory in shared storage | See "Known weaknesses" #2 |
| Exec-bridge token | memory and the child process environment only | Random per-process UUID, never written to disk |

### Adversary capabilities

| Adversary | Defended? | Notes |
|---|---|---|
| Other ordinary apps on the device | **Partially** | See "Known weaknesses" #1, #3 |
| Local-network attacker | Yes | The pairing code never leaves the device; all adb targets are forced to loopback |
| Malicious report content | Partially | The WebView has no JS bridge and cross-origin file access is off; see #2 |
| A malicious model endpoint | No (out of scope) | You configure the endpoint; trust your model provider |
| An attacker with root | No (out of scope) | Root can read any app's private data |
| Someone with physical access | No (out of scope) | Use a device lock screen |

### Explicitly out of scope

- rooted devices or devices with an unlocked bootloader
- a malicious model endpoint that you configured yourself
- you disclosing your API key or pairing code to someone else
- vulnerabilities in a device vendor's ROM
- builds you compiled yourself after modifying the source

## Known weaknesses

We disclose the issues **we know about**, ordered by risk.

### 1. The adb channel opens an unauthenticated adb server on the device (medium)

**Why:** adb's host protocol has no client authentication — it was designed on the
assumption that the host is a different, trusted computer. This app puts the host
and the target on the same device and communicates over loopback TCP, and Android
does **not** isolate loopback per app. Another app on the device could therefore
connect to that server and inherit the shell uid it exposes.

**Status: present, not mitigated.**
- **The default channel is adb** (`ActiveExec.channel`), chosen because it needs
  no second app and no permission a vendor ROM can withhold. Shizuku is
  implemented and works, but has to be selected explicitly.
- The server listens on a **fixed port** (`LocalAdbBackend.SERVER_PORT = 5038`)
  and its lifetime is **not** scoped to a run — it outlives the app and stays
  resident for the life of the installation.
- The listener is **not** explicitly bound to loopback. The bundled adb supports
  `-L`, but only `-P` is passed today, so "loopback only" is adb's own default
  behaviour rather than a contract this app enforces.
- The UI shows which channel is selected, but there is **no warning** that the
  adb channel opens a local listener.

**If you want a stronger guarantee today:** select the **Shizuku** channel in
Settings. It uses a binder plus an explicit per-app grant, with no network
listener at all.

**Planned, in order of what it buys:** make Shizuku the default channel, scope the
server's lifetime to a run instead of leaving it resident, bind explicitly with
`-L 127.0.0.1:<port>`, and surface the caveat in the UI where the channel is
chosen.

Note that a **random port is not a fix**: adb rejects port 0, and loopback is
scannable — that would be obscurity, not a boundary.

### 2. Report WebView file access (low)

**Why:** the report viewer enables `allowFileAccess`. If a report-rendering bug
ever allowed injection, malicious content could in principle read app-private
files (including model credentials).

**Status: mitigated, not eliminated.**
- No JavaScript bridge is registered (`addJavascriptInterface`)
- Only local `file://` content is loaded; no remote URLs
- The report dump escapes `<` and `>`, so model output cannot close the script block
- Cross-origin access (`allowUniversalAccessFromFileURLs`) is off

**Planned:** move to `WebViewAssetLoader` and turn file access off.

### 3. DEBUG builds export an internal service (affects self-built debug APKs only)

**Why:** the `debug` variant exports `AgentService` without a permission check, so
another app on the device could start it — including the action that runs an
AI prompt through the shell channel.

**Status:**
- **Release builds are not affected** (`exported="false"`)
- **If you build a debug APK yourself, use it only on a device you trust**
- **Planned before the first public release:** gate the exported service behind a
  signature-level permission. The naive fix (removing `exported`) would break the
  unattended `scripts/adb-bootstrap.sh` provisioning flow, which triggers
  provisioning from outside the app on purpose.

> Official builds downloaded from the Releases page are **release** variants and
> are not affected by this. (Weakness #1 still applies if you enable the adb channel.)

### 4. Model credentials are stored in plaintext (design trade-off)

`files/model.env` holds the API key in plaintext. It lives in app-private storage,
which other apps cannot read directly (unless the device is rooted).
**Do not use a production key on a device you do not trust.** Using a key scoped
to the device or purpose significantly reduces the impact.

### 5. Cleartext HTTP is allowed for model endpoints (low, opt-in by configuration)

The app sets `usesCleartextTraffic="true"` and ships no network security config, so
a Base URL that starts with `http://` is accepted and the API key, the prompts and
the screenshots travel unencrypted. The field is free text, so this is one typo —
or one self-hosted gateway — away from happening.

**Status: not restricted.** Android's default for a `targetSdk` this recent is to
refuse cleartext; this app opts out of that.

- **Nothing is wrong with `https://`**: there is no `TrustManager` or
  `HostnameVerifier` anywhere in the tree, so certificate validation is the
  platform's.
- A plain-HTTP endpoint still works, and the app does not warn.

**If you want to be sure:** use an `https://` Base URL. That is the only case this
app needs.

**Planned:** set it to `false` and add a scoped allow-list, so a self-hosted
plain-HTTP gateway is a deliberate exception rather than the default for
everything.

### 6. Native runtime comes from prebuilt third-party packages (supply chain)

The Node runtime and adb client come from Termux's arm64 packages. We **pin and
verify SHA-256 digests**, but we are not responsible for how those upstream
packages are built. The digests can be audited in
`apps/android-host/scripts/fetch-node-runtime.sh` and `fetch-adb-runtime.sh`.

The `yadb` helper (CJK text input and pinch gestures) is a third-party prebuilt
binary that ships as an app asset. It is **LGPL-3.0** (upstream
[`ysbing/YADB`](https://github.com/ysbing/YADB)), which is copyleft: redistributing
it inside this APK carries obligations beyond crediting it, and the project intends
to stop shipping it and let users who want CJK input place it themselves.

### 7. A YAML test file can run shell commands, if you let it (opt-in)

`@midscene/test` projects run YAML files, and one of the available steps,
`runAdbShell`, executes an arbitrary shell command as the shell user. That is a
strictly larger capability than operating the UI: it can read the device, change
settings, and reach other apps' data.

**Status: off by default, off in the shipped examples, and gated separately.**
- The step is registered **only** when `test.runAdbShell` is true. While it is
  off the node does not exist, so a case that uses it fails to collect and names
  the unknown node — it does not silently skip.
- The switch is **separate** from `device.exposeRunAdbShellAction`, which gates
  the same capability for the *model*. Enabling either never enables the other.
- Every run with it enabled prints a warning.

**Why the separation matters:** a YAML file is usually someone else's suite,
checked into a repository and executed unattended. That is a different trust
decision from "may the model, right now, run a command", and collapsing the two
would mean that running a downloaded test project silently widened what the
model could do — or the reverse.

**If you enable it:** treat the test project as code you trust, the same as any
script you would run on the device. Prefer a config without it, and leave it off
unless a case genuinely needs a shell.

## Security-relevant design commitments

These are design constraints; feature requests that violate them will not be accepted:

- **No silent operation** — a run must have visible, interruptible UI feedback
- **No remote-control channel** — we ship no server-side component that controls a device remotely
- **No bypassing device security** — no lock-screen bypass, privilege escalation, or persistence
- **No user data collection** — we operate no server that collects data

## Supported versions

Only the latest release receives security fixes. Builds you modified yourself are
not supported.
