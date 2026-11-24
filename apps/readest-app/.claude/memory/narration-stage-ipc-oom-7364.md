---
name: narration-stage-ipc-oom-7364
description: "#7364 Storyteller crash: 0.12.16 staged whole audio through Android's JSON IPC and OOM-killed the WebView; stored audio fixed by unreleased #7010; deflated audio fix MERGED #7367, unreleased"
metadata:
  type: project
---

#7364 (2026-11-06): on Android every IPC payload goes through JSON (`canUseCustomProtocol` is false), so one `writeFile` of a Uint8Array costs about 40x the file size. Replaying 0.12.16's staging on the reporter's 67.5 MB chapter on the Xiaomi: renderer 2.75 GB, lmk killed it, then Chromium logged "wasn't handled by all associated webviews, killing application". The app has no `onRenderProcessGone`, so any renderer OOM takes the app down.

The reporter's audio is STORED (method 0), so #7010 (merged after v0.12.16) already plays it in place; `main` does not reproduce. Deflated audio still reached `#stageBlob` on `main`. Fix MERGED #7367 (c21e4fe88) UNRELEASED, worktree removed: `writeFile(name, blob.stream(), { truncate: true })`. Truncate is required because the stream branch of writeFile does not truncate and staged names hash the href alone.

Measured: streaming costs ~300 ms/MB on the Xiaomi (39 MB about 14 s to first audio, 154 MB about 43 s). Native inflate would remove that wait. Linux and a real 0.12.16 APK were not run; #7364 stays open for Linux. Overlapping loads share one write per href; two players at once and a write finishing after release() are accepted limits. Reporter's file: ~/Documents/books/issues/7364/. Xiaomi `run-as` fails on this release-signed build, use CDP.

**Why:** "no crash on the phone" meant little: the phone runs `main`, 283 commits past the reporter's tag. Check the reporter's tag first.

Related: [[narration-ios-file-window-6989]], [[feedback-pin-adb-serial]].
