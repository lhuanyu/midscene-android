# Demo: the agent drives a car head unit

[简体中文](./README.zh.md) | **English**

One instruction, typed on the car's own screen. No computer, no cable, no adb
from a laptop:

> Open the App Centre, find QQ Music, open it and search for Coldplay, play the
> first song in the results.

In the app's own language, which is what the video shows:

> 打开应用中心，找到QQ音乐，打开搜索Coldplay，播放搜索结果的第一首歌曲。

<p align="center">
  <a href="demo-1080p.mp4">
    <img src="poster.jpg" width="720" alt="Midscene on a HarmonyOS car head unit: the Chinese instruction typed into the app, with the Run button below it">
  </a>
</p>

**[▶ Watch the 2m20s clip (23 MB, 1080p)](demo-1080p.mp4)** · **[4K original (572 MB)](https://github.com/lhuanyu/midscene-android/releases/tag/demo-v1)**

GitHub strips `<video>` out of markdown, so a repository README cannot play an
MP4 in place. The poster above is the entry point: clicking it opens the
committed clip. The clip is committed here precisely so that entry point exists;
the 4K original is a release asset, for the reason below.

## What this run is

| | |
|---|---|
| Device | A 鸿蒙车机 (a HarmonyOS car head unit) |
| Android reported by the device | Android 12 |
| Instruction language | Chinese, as quoted above |
| Model behind the agent | `qwen3.8-flash` |
| Result | one task, exit 0, run time reported by the app as 120s |
| Footage | 2m20s, 4K (3840x2160) HEVC, recorded off the screen |

`120s` is the number the app prints in its history for this run, at 1/1 task. It
is wall-clock time for the whole instruction, not the sum of the taps.

## What happens, in order

| Time in the video | On screen |
|---|---|
| 0:00 | The instruction typed into the app's prompt field, then **Run** |
| 0:02 – 0:03 | Run starts; the progress overlay pins the instruction and a **Stop** button on top of everything else |
| 0:05 – 0:20 | The agent leaves the app on its own: opens the App Centre, locates QQ Music, taps it |
| 0:20 – 0:50 | Inside QQ Music: opens search, brings up the keyboard |
| 0:50 – 1:10 | Types `Coldplay`, submits, waits for results |
| 1:10 – 1:55 | Picks the first search result and starts playback |
| 1:55 – 2:20 | Back in the app: **History** shows the finished run, opens its report |

The screen is never touched after **Run**. The overlay stays visible throughout —
that **Stop** button is the way out at any point.

## The files here

| File | What it is |
|---|---|
| `demo-1080p.mp4` | 1920x1080 H.264, 23 MB — the clip the poster above links to |
| `poster.jpg` | 1920x1080 poster frame |
| 4K original | [Release `demo-v1`](https://github.com/lhuanyu/midscene-android/releases/tag/demo-v1) |

The 4K original is a 572 MB (600,078,490 bytes) file and is **not** in git —
a file that size would sit in every clone forever. Instead:

- The **repository copy** is the 1080p transcode: small enough to be an ordinary
  part of the repo, and the thing the poster links to.
- The **4K original** is a release asset. Release assets are served separately
  from the git history, so downloading it costs the cloner nothing.

SHA-256:

```text
dec63f74ec69568cbf7499d7ff3f558c8ad88219caee295c18611e5c05f12b2d  midscene-android-demo-4k.mp4  (572 MB, 4K original)
55d02aad40d86ae4ca5e80fccde7a33569f9aeeb9ce2f6cc03e20f75824f7942  demo-1080p.mp4                (23 MB, repo copy)
```

### How the repo copy was made

```bash
ffmpeg -i midscene-android-demo-4k.mp4 \
  -vf scale=1920:-2 \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -ac 2 \
  -movflags +faststart \
  demo-1080p.mp4
```

`+faststart` matters here: it moves the moov atom to the front so the video
starts playing before the whole 23 MB has arrived. The source is 4K 30fps at
34 Mbit/s; the copy is 30fps at roughly 1.3 Mbit/s.

The source's audio track is an effectively silent AAC stream (2 kbit/s), so the
copy keeps a silent AAC track rather than pretending there is narration.

## Scope of this demo

It shows the **Run** path: one natural-language instruction, one phone, one
finished report. It does not show **Scripts** / YAML scripts, multi-task runs, or
stopping a run midway — those are documented in the [main
README](../../README.md).

The recording is here as documentation of the project. It contains the QQ Music
interface and third-party artwork; those belong to their owners and are not
covered by this repository's MIT license.
