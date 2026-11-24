---
name: rsvp-screen-wake-lock
description: Speed reading (RSVP) let the screen sleep unless Keep Screen Awake was on; MERGED #7200 (6a65ff77f) 2026-11-01 UNRELEASED; Android screen-timeout check recipe
metadata:
  node_type: memory
  type: project
  originSessionId: 426e2062-90be-4749-8504-7405cdad2a29
  modified: 2026-11-01T05:25:15.004Z
---

2026-11-01: with Keep Screen Awake off (the default), RSVP playback let the system timeout blank the
screen; nothing in RSVP held a wake lock. Fix in `RSVPControl.tsx`: `useScreenWakeLock` while words
advance (RSVP timer, or TTS when read-along drives it), skipped when the setting already holds it
(iOS shares one app-wide idle timer). MERGED as #7200 (6a65ff77f, 2026-11-01, UNRELEASED). CodeRabbit caught a
fixed-layout case: entry skipped the TTS-state replay, so the lock held a frozen word; fixed in the PR.
Known leftover: fixed-layout RSVP with Read Aloud playing keeps the screen on while audio plays
(word frozen); left as is. Auto Scroll (`useAutoScroll`) has the same gap, not fixed.

**How to check on Android (Xiaomi 368b0948):** Android WebView `navigator.wakeLock` works and shows
as `mHoldScreenWindow=Window{...readest...}` in `adb shell dumpsys window`; poll
`dumpsys power | grep mWakefulness` (Awake/Dozing). Shorten the timeout with
`settings put system screen_off_timeout 15000` and restore the old value (was 600000) afterwards.
Closing RSVP moves the reading position to where it stopped: record the CFI first and `view.goTo` it back.

Related: [[feedback-pin-adb-serial]], [[native-cover-above-ime-7171]].
