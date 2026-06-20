---
name: rsvp-control-bar-overlap-revert
description: RSVP mobile control bar overlap was a REGRESSION — PR
metadata: 
  node_type: memory
  type: project
  originSessionId: cc658a96-fce5-4922-b924-361173c57e2a
---

RSVP (Speed Reading) overlay control bar: on narrow phones (Xiaomi 13 = 360px CSS width) the audio (TTS 🔊) toggle + settings ⚙ gear overlapped the right end of the centered transport row, hiding the "skip forward 15" label.

**This was a regression, not a new bug.** PR #4585 (`51fede1a0`, merged 2026-06-14 19:18Z) already fixed it: replaced the `absolute end-0` cluster with a single in-flow `flex items-center justify-between md:justify-center` row — audio toggle far-left, settings far-right, flanking the centered play button; secondary buttons tightened to `h-8 w-8 shrink-0 md:h-9 md:w-9`, skip buttons `px-1.5 md:px-2`. At 360px the 9 controls pack ~340px into a 336px row with zero gaps but **no overlap** (verified on-device).

**Reverted by PR #4589** (`490824504`, `feat/word-wise`, Word Wise inline vocab). Branch created 19:13Z — 5 min BEFORE #4585 merged — and merged ~10.5h later WITHOUT rebasing. The squash carried the stale pre-#4585 `RSVPOverlay.tsx`, so its diff is an exact mirror revert: #4585 = +53/−51 src & +29 test; #4589 = +51/−53 src & −29 test. #4589 added ZERO Word Wise code to RSVPOverlay — those hunks were purely the revert. It also deleted #4585's guard test (`audioBtn.closest('.absolute')).toBeNull()`), so CI couldn't catch the reintroduced overlap.

**Re-fix (this session):** restored the #4585 block byte-for-byte + re-added a guard test (`audio/settings share the play button's parent`, parent `className` has no `absolute`) in `rsvp-overlay-context.test.tsx`. Pattern to watch: a stale feature branch squash-merged after an intervening fix silently reverts it — see [[security-advisories-web-2026-06]] (shared-target worktree build-cache pollution) for the same stale-branch family.

**On-device verify recipe:** app running → `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` → enter RSVP by dispatching synthetic `KeyboardEvent('keydown',{key:'v',shiftKey:true})` on `window` (Shift+V shortcut, listener on window; blur activeElement first) → click "From Current Page" → CDP-mutate the live DOM to preview a layout fix before rebuilding (apply exact source classes + reparent, then `getBoundingClientRect` overlap check + `adb exec-out screencap`). See [[cdp-android-webview-profiling]].
