---
name: tts-download-queue-5690
description: "PR #5690 TTS offline download queue — Xiaomi device verify results, the book-end session-stop gotcha, and the one-off vanished-row race seen after Clear all"
metadata: 
  node_type: memory
  type: project
  originSessionId: 30e90eee-24f9-4e8e-bb59-133bee1ea5b1
  modified: 2026-08-16T08:39:54.025Z
---

PR #5690 (feat/tts-download-queue, closes #5688/#5689/#5692) — MERGED 2026-08-16 after review + Xiaomi 13 device verify.

**Verified on device (all PASS):** queue two chapters → strict one-at-a-time with "Waiting…" rows; cancel mid-synthesis → successor takes over (no #5688 invisible stall), requeue parks behind; force-stop mid-download → rows restore (in_progress→pending), completed chapters stay Downloaded, resume on next session attach; Cancel all drops rows but keeps downloaded audio; Clear all removes pinned packs but keeps warm cache ("Partly downloaded" rows survive); local bookshelf delete removes tile + queue rows with no cleanup errors in logcat.

**Session lifecycle gotchas (by design but observable):** playback reaching book end stops the whole TTS session → player sheet closes AND queue processing pauses (rows park until the book next has a live session); a download active at session teardown gets marked "failed" (retryable, needs manual re-tap — not auto-resumed). Worth UX follow-up someday.

**One-off unreproduced race:** tapping download on a chapter seconds after Clear all, while playback was ending at book end, made the queue row vanish with NO audio downloaded and no failed state. Suspect the `sections.length === 0` "already packed" early-exit in ttsDownloadManager `#execute` reading stale/closing-store statuses, or the teardown window. Recoverable by re-tapping under a live session (verified downloads then complete in ~5s). Reported in review; not a blocker.

**Loose ends after merge:** other locales only have pt-BR translations for the new strings (`Remove from queue`, `Waiting…`, `Cancel all ({{count}})`) — the next `/i18n` run picks them up. Cache-limit eviction survival not device-tested (unit-covered only). The two observations above (book-end failed-mark, vanished-row race) remain open follow-ups.

**Device-drive recipe:** the TTS sheet flow is Speak → "Open Read Aloud player" → "Offline Audio"; badges expose `Download chapter:|Stop downloading:|Remove from queue:|Downloaded:|Resume download: <label>` aria-labels. localStorage `readest_tts_download_queue` lags live state (persist only on enqueue/finish/fail, not progress) — read the DOM for live status. Library long-press/contextmenu leaves select mode ON: subsequent tile clicks toggle selection, use the action-menu "Open". See [[android-cdp-e2e-lane]] for the CDP transport.
