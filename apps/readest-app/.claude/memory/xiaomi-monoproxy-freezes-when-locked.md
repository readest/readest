---
name: xiaomi-monoproxy-freezes-when-locked
description: Xiaomi 368b0948 - every app loses ALL network while the screen is locked, because MonoProxy's tunnel dies; unlock before any network-dependent device test
metadata:
  type: reference
---

On the Xiaomi (368b0948), **all app network dies while the screen is locked** and
comes back the moment it is unlocked. Symptom from inside Readest: hostname URLs
fail in ~15ms (DNS), IP-literal URLs time out after 30s (TCP blackhole), and even
`http://192.168.2.1/` (the LAN gateway) is unreachable -- while `adb shell ping`
to that same gateway succeeds, because the shell runs as a different UID.

Cause: `com.r3studio.monoproxy` (appId **10452**) is a per-app VPN. `ip rule` sends
every UID *except* 10452/20452 to table 1033, which is all `dev tun0`. Readest is
appId 10454, so it is inside the tunnel. When the screen locks, MIUI freezes
MonoProxy, the tunnel stops passing traffic, and everything inside it blackholes.
`dumpsys deviceidle` still reports ACTIVE and `oom_score_adj` is 0, so nothing in
the usual doze/standby diagnostics explains it -- do not go hunting there.

**How to apply:** before any network-dependent device verification, check
`adb shell "dumpsys trust | grep -o 'deviceLocked=[01]'"`. If it is `deviceLocked=1`
the phone needs a credential and only the user can unlock it -- `input keyevent
KEYCODE_WAKEUP` plus a swipe is not enough. `svc power stayon true` does not prevent
the relock either. Ask the user to unlock, then re-test; the tunnel revives on its own.

Also: the WebView devtools HTTP endpoint (`/json/list`) only answers while the screen
is awake, and **node's `fetch` cannot talk to it at all** (hangs; curl works) -- fetch
the target list with curl, cache the ws URL, and drive it with node's `WebSocket`.
Tauri re-injects its IPC init script, which **silently replaces any hook you install
on `window.__TAURI_INTERNALS__.invoke`** -- reinstall it immediately before measuring,
or your instrumentation will record nothing and look like the feature is broken.
See [[feedback-always-verify-on-xiaomi]].
