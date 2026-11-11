---
name: koreader-kindle-e2e-gotchas
description: "Non-obvious traps when driving KOReader on the Kindle with koreader-e2e ko.sh (taps, suspend, restarts, deploy, fault injection)"
metadata:
  node_type: memory
  type: reference
  originSessionId: cc8251fc-1efb-47f2-b565-e06504a5e9e4
  modified: 2026-10-09T13:38:16.539Z
---

Learned during PR #6684 device verification (2026-10-09):

- **Repeated identical tap coordinates are dropped**: the kernel filters unchanged ABS values, so a second `ko.sh tap X Y` at the same point lands nowhere. Jitter coordinates by a pixel or two.
- **`ko.sh deploy` wipes LocalSend**: the built zip has an empty `bin/`; restore by installing the release `Readest-<ver>-N.koplugin.zip` (has `bin/localsend-helper-*`).
- **SIGTERM restart does not save the open book's sidecar position**; the book reopens at an older autosave. Set `last_xpointer` in `<book>.sdr/metadata.epub.lua` while KOReader is stopped to restore a user's page.
- **`kill -9` of luajit** lets koreader.sh's exit cleanup return touch input to the framework; recover with a proper `ko.sh kindle restart`.
- **Suspend/resume**: writing KEY_POWER to /dev/input/event0 does nothing; use `lipc-set-prop com.lab126.powerd powerButton 1` (twice) — triggers onResume pulls.
- **Turning Wi-Fi off kills SSH**; script the whole off/on sequence on-device with nohup + `/var/tmp/ko-e2e-tap.lua`. KOReader only broadcasts NetworkConnected when it turns Wi-Fi on itself.
- **Breaking DNS** (`/var/run/resolv.conf`) makes KOReader think it is offline and prompt for Wi-Fi before any plugin request — not usable to test DNS errors.
- **Success pushes are silent at INFO**; add temporary `logger.info` probes via `ko.sh push`, and use an on-device curl oracle against `/api/sync?type=configs` (token read on device, never printed).
- **Clock tests poison the server**: pushing with the clock ahead leaves a future-dated config that wins LWW until real time passes it.
- This Kindle runs KOReader without Turbo (`UIManager.looper` nil): all sync RPCs go through forked workers.

Learned during #6685 exit trials (2026-11-03, Kindle Voyage 5.13.6):

- **simpleui turns the reader's Exit into "close to home"**: Exit from inside a book does not quit. Opening the home screen menu right after closing a book crashed KOReader (`screensaver_menu.lua:301 'ui' nil`, simpleui's quicksettings bar). For exit-from-book tests, set `plugins_disabled = { simpleui = true }` and `start_with = "last"` while KOReader is stopped. KOReader rewrites `plugins_disabled` across several lines on exit, so a one-line sed won't undo it.
- **The first tap after a launch is often dropped**: retry with jittered coordinates and check the log ("opening file") or a screenshot.
- **The Kindle framework status bar drawn over KOReader** (e.g. "9:22 PM" top right) means touch went to the framework, after a duplicate instance's cleanup or a sleep/wake. A `ko.sh kindle restart` fixes it. Never launch `koreader.sh` while one is already running.
- **Wi-Fi drops after ~4-5 scripted exit/relaunch cycles** (`not online`, DNS failure), and SSH goes with it. Ask the user to wake the device; keep trial batches short.
- An on-device trial loop (`setsid nohup sh script &`) survives KOReader exits, because dropbear runs on its own (ppid 1).

Related: [[koplugin-slow-tls-push-and-open-race]]
