#!/bin/bash
# launch-linux.sh <readest-binary> <fake-home> [cdp-port]
# Runs the Linux CEF build isolated from the real profile: fake HOME and XDG dirs, a private
# D-Bus (single-instance can't forward into another Readest), the stub portal for file
# dialogs, stubbed xdg-open/gio/zenity, and CDP on <cdp-port> (default 9231). Nothing reaches
# the real desktop, so sign-in is by email and password: an OAuth provider's callback can't
# return to this app.
# Needs QA_DIR: the run's work dir (portal.log, answer.json, zenity-answer).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
BIN=$1; H=$2; PORT=${3:-9231}
: "${QA_DIR:?set QA_DIR to the run work dir}"
[ -x "$BIN" ] || { echo "no binary at $BIN" >&2; exit 1; }
if ss -ltn | grep -q ":$PORT "; then echo "port $PORT is in use (another session?)" >&2; exit 1; fi
mkdir -p "$H" "$QA_DIR"
exec env -u XDG_CURRENT_DESKTOP -u DESKTOP_SESSION -u GNOME_DESKTOP_SESSION_ID \
  HOME="$H" XDG_DATA_HOME="$H/.local/share" XDG_CONFIG_HOME="$H/.config" XDG_CACHE_HOME="$H/.cache" \
  QA_DIR="$QA_DIR" \
  PATH="$HERE/stubbin:$PATH" READEST_CDP_PORT="$PORT" RUST_BACKTRACE=1 \
  dbus-run-session -- bash -c '/usr/bin/python3 "$0" & sleep 1; exec "$@"' "$HERE/stub_portal.py" "$BIN"
