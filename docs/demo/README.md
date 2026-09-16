# Demo: the agent drives a car head unit

[简体中文](./README.zh.md) | **English**

One instruction, typed on the car's own screen. No computer, no cable, no adb
from a laptop:

> 打开应用中心，找到QQ音乐，打开搜索Coldplay，播放搜索结果的第一首歌曲。

<p align="center">
  <video src="demo-1080p.mp4" poster="poster.jpg" width="720" controls muted playsinline>
    Your browser cannot play this video inline.
    <a href="demo-1080p.mp4">Download the 1080p clip (23 MB)</a>.
  </video>
</p>

## What this run is

| | |
|---|---|
| Device | 鸿蒙车机 (HarmonyOS car head unit) |
| Android reported by the device | Android 12 |
| Instruction language | Chinese, as typed above |
| Model behind the agent | `qwen3.8-flash` |
| Result | one task, exit 0, run time reported by the app as 120s |
| Footage | 2m20s, 4K (3840x2160) HEVC, recorded off the screen |

`120s` is the number the app prints in its history for this run, at 1/1 task. It
is wall-clock time for the whole instruction, not the sum of the taps.

## What happens, in order

| Time in the video | On screen |
|---|---|
| 0:00 | The instruction typed into the app's 指令 field, then 运行 |
| 0:02 – 0:03 | Run starts; the progress overlay pins the instruction and a 停止 button on top of everything else |
| 0:05 – 0:20 | The agent leaves the app on its own: opens 应用中心, locates QQ音乐, taps it |
| 0:20 – 0:50 | Inside QQ音乐: opens search, brings up the keyboard |
| 0:50 – 1:10 | Types `Coldplay`, submits, waits for results |
| 1:10 – 1:55 | Picks the first search result and starts playback |
| 1:55 – 2:20 | Back in the app: 历史 shows the finished run, opens its report |

The screen is never touched after 运行. The overlay stays visible throughout —
that 停止 button is the way out at any point.

## The files here

| File | What it is |
|---|---|
| `demo-1080p.mp4` | 1920x1080 H.264, 23 MB — the copy that plays inline above and that lives in this repository |
| `poster.jpg` | 1920x1080 poster frame |
| 4K original | [Release `demo-v1`](https://github.com/lhuoanyu/midscene-android/releases/tag/demo-v1) |

The 4K original is a 572 MB (600,078,490 bytes) file and is **not** in git —
a file that size would sit in every clone forever. Instead:

- The **repository copy** is the 1080p transcode, small enough to be a normal
  part of the repo and to play in the page above.
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

It shows the 运行 path: one natural-language instruction, one phone, one
finished report. It does not show 脚本 / YAML scripts, multi-task runs, or
stopping a run midway — those are documented in the [main
README](../../README.md).

The recording is here as documentation of the project. It contains the QQ Music
interface and third-party artwork; those belong to their owners and are not
covered by this repository's MIT license.
