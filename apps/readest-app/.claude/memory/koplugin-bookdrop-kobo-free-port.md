---
name: koplugin-bookdrop-kobo-free-port
description: Kobo shows "Nearby BookDrop error: could not find a free port" every launch; toast silenced for automatic starts in #6604, root cause UNKNOWN
metadata:
  type: project
  modified: 2026-10-03T13:07:14.038Z
---

Reddit r/koreader 1wvti1a (2026-10-02): Kobo users saw "Nearby BookDrop error: could not find a free port." on every KOReader launch; turning BookDrop off was the workaround. BookDrop is default-on since #6321, so the plugin auto-starts it (init / onResume / onNetworkConnected).

The message comes only from `Helper.pickPort` (`library/localsend_helper.lua`): bind 127.0.0.1:0 inside KOReader's own process, BEFORE any helper is spawned. Stale helper processes cannot cause it (they hold a few ports; ephemeral range is ~28k; helper exits on control-socket EOF; start/stop pkill). Leading guess: the loopback bind itself fails on those Kobos (lo not up?) — unverified, no Kobo available.

MERGED #6604 (2a795dc27) UNRELEASED: `startService(true)` for automatic starts logs instead of toasting; pickPort returns its error; every failed start logs `ReadestLocalSend: ...: <err>`.

**Why:** the real cause is still open; if loopback bind fails, the helper's own 127.0.0.1 control socket fails too, so BookDrop can't work on those devices.

**How to apply:** after release, get a Kobo user's crash.log and read the `ReadestLocalSend:` warning before changing the transport. Related: [[koplugin-localsend-receive]].
