---
name: ubuntu-gnome-shell-restart-fail-whale
description: "On the Ubuntu box (192.168.2.3, X11, systemd-managed GNOME) killall -3 gnome-shell triggers the \"Oh no\" logout screen; how to recover without losing terminals"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 3ce9fca6-0a3f-41b4-9a8d-e3fc1dcec948
  modified: 2026-10-10T16:25:37.580Z
---

Never `killall -3 gnome-shell` on the Ubuntu desktop at 192.168.2.3 (Ubuntu X11 session, GNOME 48, systemd-managed session). SIGQUIT core-dumps the shell, systemd counts it as a failure, and `gnome-session-failed` shows the "Oh no! Something has gone wrong" screen, even though `org.gnome.Shell@x11.service` restarts fine.

**Why:** 2026-10-11, used it to fix "cursor moves but clicks do nothing" and hit the fail screen. Clicking Log Out, or killing `gnome-session-failed`, ends the session and closes every terminal, because the unit has `ExecStopPost=gnome-session-ctl --shutdown`.

**How to apply:** For an in-place shell restart, have the user press Alt+F2 → `r` at the keyboard instead. If the fail screen is already up: add a drop-in that clears it (`~/.config/systemd/user/gnome-session-failed.service.d/*.conf` with `[Service]` and an empty `ExecStopPost=`), run `daemon-reload`, then `systemctl --user stop gnome-session-failed.service`. A SIGTERM stop counts as a clean exit, so `OnFailure` doesn't fire. Remove the drop-in and reload again afterwards. This worked and kept all windows open.

Also: `pkill -f <name>` over ssh matches its own ssh command line and kills the connection. Use `pkill -x` or a `[b]racket` pattern.
