---
name: koreader-e2e
description: >
  Use when a readest.koplugin change must be verified on a real KOReader
  device (Kindle over SSH or Android over adb): reproducing a user report,
  confirming a sync/library/stats fix, driving the KOReader UI, capturing
  device screenshots or KOReader logs, or when busted specs pass but device
  behavior is unknown. Also for "test on Kindle", "test on Android", "verify
  on device", ANR/crash on KOReader, and KOReader memory measurements.
user_invocable: true
---

# KOReader end-to-end testing

Busted specs run the plugin against stubs. Real devices differ in ways stubs
cannot show: writable paths, tmpfs size, fork behavior, SQLite on `/sdcard`,
the Android ANR watchdog. A plugin fix is verified only after it runs on a
device through the real KOReader UI.

All device access goes through `ko.sh` next to this file:

```bash
KO=apps/readest-app/.claude/skills/koreader-e2e/ko.sh   # from the repo root
$KO help
```

## Workflow

1. **Check the device.** Run `$KO kindle check` and/or `$KO android check`: device,
   KOReader pid, plugin version, signed in or not, network. If the Kindle times
   out, it is asleep or its Wi-Fi is off: ask the user to wake it.
2. **Install the code under test.** Use `$KO <t> deploy [VERSION]` for the whole
   plugin built from this checkout, or `$KO <t> push library/syncbooks.lua ...`
   for single files.
3. **Restart KOReader** with `$KO <t> restart`. KOReader loads plugin modules
   once, so pushed Lua does nothing until a restart. On both platforms a
   restart closes the book the user has open: say so before doing it.
4. **Drive the UI to just before the action under test.** Loop: `$KO <t> shot
   NAME`, Read the PNG, pick coordinates from it, `$KO <t> tap X Y`, and take
   another screenshot to confirm the tap landed.
5. **Open a log window right before the action** with `$KO <t> log-reset`, then
   do the action. KOReader and the plugin log on their own: for example,
   opening the Readest Library starts a sync. A window opened earlier would
   catch that and give a false pass.
6. **Assert on logs.** For a sync, wait for the completion line:
   `$KO <t> wait-log 'runCloudSync\[.*\] done' 90`. (`pullBooks complete` fires
   before the push half has run.) Then run `$KO <t> log 'error|traceback|ANR'`.
7. **Report the evidence**: the exact log lines, and screenshots that show the
   end state.

## Quick reference

| Need | Command |
|---|---|
| Shell on device | `$KO kindle sh 'free; df /var'` |
| Plugin settings | `$KO <t> sh 'grep -A25 readest_sync <ko>/settings.reader.lua'` (`<ko>` = `/mnt/us/koreader` or `/sdcard/koreader`) |
| Only the new log lines | `$KO <t> log 'Readest'` |
| Screenshot directory | `$KO_OUT` (default `$TMPDIR/koreader-e2e`) |
| Other Kindle | `KINDLE_HOST=… KINDLE_PORT=… $KO kindle …` |
| Other Android | `ANDROID_SERIAL=… $KO android …` |

**Getting around the UI** (from screenshots; coordinates depend on the device):
- KOReader main menu: tap the top edge (the ∨ handle on Kindle), then the
  tools tab → **Readest** → **Readest library**. The menu reopens on the last
  tab used, so check which tab is selected before tapping.
- The Readest submenu starts with **Log out as <user>** when signed in, and
  `$KO <t> check` prints `readest: signed in|out`.
- Readest Library view menu (Sync now, Rescan library, …): tap the library's
  title.
- Android screenshots come back scaled down for display. Multiply by the scale
  the Read tool reports before tapping; Kindle screenshots are 1:1.

## What the logs can and cannot show

- KOReader logs at INFO by default. The sync client logs failures only at
  `logger.dbg`, so a failed RPC shows up as `success=false status=nil` in
  `ReadestLibrary` lines, with no reason given. Look at the caller's INFO lines.
- A status of `nil` means the request never got an HTTP response: the worker
  failed, or the network was down. Rule out the network first: `$KO <t> check`
  reports it (Kindle: HTTP 403 `Not authenticated` from the Readest API = reachable).
- On Android, `$KO android log` includes system lines. `ANR in org.koreader…`
  followed by `Process … exited due to signal 9` means Android killed KOReader
  because its UI thread was blocked for more than 5 s. That is not a Lua error.
- Measuring memory of a forked worker: an unrooted Android cannot read another
  process's `smaps`. Have the child read `/proc/self/smaps` and append the
  totals to a file. Use `Private_Dirty`, not RSS: RSS counts pages shared with
  the parent after `fork()`.

## Device facts that bite

| Fact | Consequence |
|---|---|
| Android `/tmp` is `shell:shell 0771` | `os.tmpname()` throws inside KOReader. Write temp files under `DataStorage:getSettingsDir()` |
| Kindle `/tmp` → `/var/tmp`, a 64 MB tmpfs filled by `fm-out-*` metrics files; cleared only by rebooting the Kindle | Large writes to `/tmp` get cut short |
| `koreader.sh` keeps only the last 500 KB of `crash.log` at each launch | Never address log lines by line number; `log-reset` writes a marker line instead |
| Kindle SSH (KOReader's dropbear) takes a blank password, rejects keys | `ko.sh` handles this; don't add keys |
| Kindle's busybox `ash` has no `<(...)`, no arrays | Keep `sh` commands POSIX |
| `FFIUtil.runInSubProcess` returns the child's pid, not its results | Use `Trapper:dismissableRunInSubprocess` to get results back |
| One SQLite commit per row on `/sdcard` takes several ms | Loops of upserts need one transaction, or they can hit the ANR watchdog |

## Leave the device as you found it

- If a test needs a user setting changed (e.g. `home_dir` for Rescan library),
  edit `settings.reader.lua` only while KOReader is stopped, and change it back
  afterwards.
- Remove probes and instrumentation. Put the real plugin files back with
  `push` or `deploy`.
- Never type into a login or password field, and never print tokens from
  `settings.reader.lua`. If the session is dead, ask the user to sign in on the
  device.
