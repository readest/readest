#!/usr/bin/env bash
# ko.sh — drive a real KOReader device (Kindle over SSH, Android over adb)
# for end-to-end testing of readest.koplugin. Run `ko.sh help` for usage.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SKILL_DIR" rev-parse --show-toplevel)"
PLUGIN_DIR="$REPO_ROOT/apps/readest.koplugin"

KINDLE_HOST="${KINDLE_HOST:-192.168.2.180}"
KINDLE_PORT="${KINDLE_PORT:-2222}"
KO_ANDROID_PKG="${KO_ANDROID_PKG:-org.koreader.launcher}"
KO_OUT="${KO_OUT:-${TMPDIR:-/tmp}/koreader-e2e}"
mkdir -p "$KO_OUT"

KINDLE_KO=/mnt/us/koreader
ANDROID_KO=/sdcard/koreader

die() { echo "ko.sh: $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ko.sh <kindle|android> <command> [args]

Commands:
  check                 Connectivity, KOReader pid, plugin version, free memory
  deploy [VERSION]      Build the plugin zip from this checkout and install it
                        (VERSION stamps _meta.lua; default dev-<sha>)
  push FILE...          Copy plugin files (paths relative to apps/readest.koplugin)
  restart               Restart KOReader (needed to load changed Lua modules)
  shot NAME             Screenshot to $KO_OUT/<target>-NAME.png (prints the path)
  tap X Y               Tap at screen pixel coordinates
  log-reset             Start a fresh log window for `log` / `wait-log`
  log [REGEX]           KOReader log lines since log-reset (optionally filtered)
  wait-log REGEX [SECS] Wait until REGEX appears in the log (default 60s)
  sh CMD                Run a shell command on the device

Env: KINDLE_HOST (192.168.2.180) KINDLE_PORT (2222) ANDROID_SERIAL
     KO_ANDROID_PKG (org.koreader.launcher) KO_OUT (screenshot dir)
EOF
}

# --- Kindle transport -------------------------------------------------------
# KOReader's SSH plugin (dropbear) accepts a blank password; keys are rejected.
ASKPASS="$KO_OUT/.askpass.sh"
[ -x "$ASKPASS" ] || { printf '#!/bin/sh\necho ""\n' > "$ASKPASS"; chmod +x "$ASKPASS"; }
kssh() {
  DISPLAY=none SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force \
    ssh -o ConnectTimeout=10 -o ServerAliveInterval=10 -o StrictHostKeyChecking=no \
        -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 \
        -p "$KINDLE_PORT" "root@$KINDLE_HOST" "$@"
}

# Kindle's busybox ash: no <(...), no bash arrays. Keep remote scripts POSIX.
KINDLE_TAP_LUA='
local ffi = require("ffi")
ffi.cdef[[
struct timeval { long tv_sec; long tv_usec; };
struct input_event { struct timeval time; uint16_t type; uint16_t code; int32_t value; };
int open(const char *, int); int write(int, const void *, size_t); int close(int);
int gettimeofday(struct timeval *, void *); int usleep(unsigned int);
]]
local x, y = tonumber(arg[1]), tonumber(arg[2])
local fd = ffi.C.open(arg[3], 1)
assert(fd >= 0, "cannot open " .. arg[3])
local ev = ffi.new("struct input_event")
local function emit(t, c, v)
  ffi.C.gettimeofday(ev.time, nil); ev.type, ev.code, ev.value = t, c, v
  ffi.C.write(fd, ev, ffi.sizeof(ev))
end
-- Multitouch protocol B: one contact in slot 0, down then up.
emit(3, 0x2f, 0); emit(3, 0x39, 4242); emit(3, 0x35, x); emit(3, 0x36, y)
emit(3, 0x3a, 50); emit(1, 330, 1); emit(0, 0, 0)
ffi.C.usleep(80000)
emit(3, 0x2f, 0); emit(3, 0x39, -1); emit(1, 330, 0); emit(0, 0, 0)
ffi.C.close(fd)
'

# Raw 8bpp grayscale framebuffer -> PNG (no PIL needed).
FB2PNG_PY='
import sys, zlib, struct
raw, out, W, H, stride = open(sys.argv[1], "rb").read(), sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
rows = b"".join(b"\x00" + raw[y*stride:y*stride+W] for y in range(H))
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
open(out, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 0, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))
'

kindle_touch_dev() {
  # Pick the touchscreen by its input device name (cyttsp4_mt on Voyage/PW3).
  kssh 'for h in /sys/class/input/event*; do
          n=$(cat $h/device/name 2>/dev/null)
          case "$n" in *_mt|*touch*|*Touch*|cyttsp*|zforce*) echo /dev/input/${h##*/}; exit 0;; esac
        done; exit 1'
}

# --- Android transport -----------------------------------------------------
adbs() { adb "$@"; }
android_pid() { adbs shell pidof "$KO_ANDROID_PKG" 2>/dev/null | tr -d '\r' || true; }

# --- Commands ----------------------------------------------------------------
cmd_check() {
  case "$TARGET" in
    kindle)
      kssh 'echo "model: $(cat /proc/usid 2>/dev/null | cut -c1-6) fb: $(head -1 /sys/class/graphics/fb0/modes)";
            echo "koreader pids: $(pidof luajit)";
            grep -h "version" '"$KINDLE_KO"'/plugins/readest.koplugin/_meta.lua;
            grep -h "home_dir" '"$KINDLE_KO"'/settings.reader.lua || echo "home_dir: unset";
            grep -q "\"refresh_token\"\]" '"$KINDLE_KO"'/settings.reader.lua && echo "readest: signed in" || echo "readest: signed out";
            echo "readest api: HTTP $(curl -sS -m 10 -o /dev/null -w "%{http_code}" https://web.readest.com/api/sync 2>&1) (403 = reachable, unauthenticated)";
            free | head -2; df /var | tail -1' ;;
    android)
      adbs get-state >/dev/null 2>&1 || die "no adb device"
      echo "device: $(adbs shell getprop ro.product.model | tr -d '\r')"
      echo "koreader pid: $(android_pid)"
      adbs shell "grep -h version $ANDROID_KO/plugins/readest.koplugin/_meta.lua; grep -h home_dir $ANDROID_KO/settings.reader.lua || echo 'home_dir: unset'"
      adbs shell "grep -q '\"refresh_token\"\]' $ANDROID_KO/settings.reader.lua && echo 'readest: signed in' || echo 'readest: signed out'"
      echo "network: $(adbs shell 'ping -c 1 -W 3 web.readest.com >/dev/null 2>&1 && echo reachable || echo unreachable' | tr -d '\r')" ;;
  esac
}

cmd_deploy() {
  local version="${1:-}" zip="$KO_OUT/readest.koplugin.zip" stage="$KO_OUT/stage"
  node "$PLUGIN_DIR/scripts/build-koplugin.mjs" ${version:+--version "$version"} --out "$zip" | tail -1
  rm -rf "$stage" && mkdir -p "$stage" && (cd "$stage" && unzip -q "$zip")
  case "$TARGET" in
    kindle)
      # scp/sftp are unreliable against KOReader's dropbear; stream over ssh.
      # Stop the LocalSend helper first (killall, never pgrep -f: it matches itself).
      cat "$zip" | kssh "cat > /var/local/ko-e2e.zip && killall localsend-helper-armv7 2>/dev/null;
        cd $KINDLE_KO/plugins && rm -rf readest.koplugin && unzip -oq /var/local/ko-e2e.zip &&
        rm -f /var/local/ko-e2e.zip && sync && grep version readest.koplugin/_meta.lua" ;;
    android)
      adbs shell "rm -rf $ANDROID_KO/plugins/readest.koplugin"
      adbs push "$stage/readest.koplugin" "$ANDROID_KO/plugins/" | tail -1
      adbs shell "grep version $ANDROID_KO/plugins/readest.koplugin/_meta.lua" ;;
  esac
  echo "Installed. Run: ko.sh $TARGET restart"
}

cmd_push() {
  [ $# -gt 0 ] || die "push needs at least one file"
  local f
  for f in "$@"; do
    [ -f "$PLUGIN_DIR/$f" ] || die "no such plugin file: $f"
    case "$TARGET" in
      kindle)  kssh "cat > $KINDLE_KO/plugins/readest.koplugin/$f && sync" < "$PLUGIN_DIR/$f" ;;
      android) adbs push "$PLUGIN_DIR/$f" "$ANDROID_KO/plugins/readest.koplugin/$f" >/dev/null ;;
    esac
    echo "pushed $f"
  done
}

cmd_restart() {
  case "$TARGET" in
    kindle)
      # SIGTERM lets KOReader save state and exit; then relaunch the way KUAL does.
      kssh "P=\$(ps | grep '[r]eader.lua' | awk '{print \$1}' | sort -n | head -1);
        [ -n \"\$P\" ] && kill -TERM \$P;
        i=0; while pidof luajit >/dev/null && [ \$i -lt 30 ]; do sleep 1; i=\$((i+1)); done;
        sleep 3; cd $KINDLE_KO && (setsid nohup ./koreader.sh --kual >/dev/null 2>&1 &);
        i=0; while ! pidof luajit >/dev/null && [ \$i -lt 30 ]; do sleep 1; i=\$((i+1)); done;
        sleep 15; echo \"koreader pids: \$(pidof luajit)\"" ;;
    android)
      adbs shell am force-stop "$KO_ANDROID_PKG"
      adbs shell monkey -p "$KO_ANDROID_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
      local i=0; until [ -n "$(android_pid)" ] || [ $i -ge 20 ]; do sleep 1; i=$((i+1)); done
      sleep 8; echo "koreader pid: $(android_pid)" ;;
  esac
}

cmd_shot() {
  local out="$KO_OUT/$TARGET-${1:?shot needs a NAME}.png"
  case "$TARGET" in
    kindle)
      local geo w h stride bpp
      geo=$(kssh 'head -1 /sys/class/graphics/fb0/modes; cat /sys/class/graphics/fb0/stride /sys/class/graphics/fb0/bits_per_pixel')
      w=$(echo "$geo" | sed -n 1p | sed -E 's/.*:([0-9]+)x([0-9]+).*/\1/')
      h=$(echo "$geo" | sed -n 1p | sed -E 's/.*:([0-9]+)x([0-9]+).*/\2/')
      stride=$(echo "$geo" | sed -n 2p); bpp=$(echo "$geo" | sed -n 3p)
      [ "$bpp" = 8 ] || die "framebuffer is ${bpp}bpp; only 8bpp grayscale Kindles are supported"
      kssh "head -c $((stride * h)) /dev/fb0" > "$KO_OUT/fb.raw"
      python3 -c "$FB2PNG_PY" "$KO_OUT/fb.raw" "$out" "$w" "$h" "$stride" ;;
    android)
      adbs exec-out screencap -p > "$out" ;;
  esac
  echo "$out"
}

cmd_tap() {
  local x="${1:?tap needs X}" y="${2:?tap needs Y}"
  case "$TARGET" in
    kindle)
      local dev; dev=$(kindle_touch_dev) || die "no touchscreen input device found"
      printf '%s' "$KINDLE_TAP_LUA" | kssh "cat > /var/tmp/ko-e2e-tap.lua && cd $KINDLE_KO && ./luajit /var/tmp/ko-e2e-tap.lua $x $y $dev" ;;
    android)
      adbs shell input tap "$x" "$y" ;;
  esac
}

MARK_FILE() { echo "$KO_OUT/.logmark-$TARGET"; }

cmd_log_reset() {
  case "$TARGET" in
    # koreader.sh trims crash.log to its last 500 KB on every launch, so line
    # numbers shift across restarts; a marker line survives the trim.
    kindle)
      local mark="ko-e2e-mark-$(date +%s)-$$"
      kssh "echo $mark >> $KINDLE_KO/crash.log"
      echo "$mark" > "$(MARK_FILE)" ;;
    # Remember the device clock instead of `logcat -c`, which would wipe the
    # whole device log, not just ours.
    android) adbs shell "date +'%m-%d %H:%M:%S.000'" | tr -d '\r' > "$(MARK_FILE)" ;;
  esac
  echo "log window reset"
}

log_since_mark() {
  local mark; mark=$(cat "$(MARK_FILE)" 2>/dev/null || true)
  case "$TARGET" in
    kindle)
      [ -n "$mark" ] || die "run: ko.sh kindle log-reset"
      kssh "awk -v m='$mark' 'found { print } index(\$0, m) { found = 1 }' $KINDLE_KO/crash.log" ;;
    # KOReader tag plus system lines that explain kills (ANR, crashes, signals).
    android)
      [ -n "$mark" ] || die "run: ko.sh android log-reset"
      adbs logcat -d -T "$mark" | grep -E " [VDIWEF] KOReader *:|ANR in $KO_ANDROID_PKG|Process $KO_ANDROID_PKG|FATAL|Force finishing" || true ;;
  esac
}

cmd_log() {
  if [ $# -gt 0 ]; then log_since_mark | grep -E -- "$1" || true; else log_since_mark; fi
}

cmd_wait_log() {
  local re="${1:?wait-log needs a REGEX}" secs="${2:-60}" start=$SECONDS
  while [ $((SECONDS - start)) -lt "$secs" ]; do
    if log_since_mark | grep -E -- "$re"; then return 0; fi
    sleep 2
  done
  die "timed out after ${secs}s waiting for: $re"
}

cmd_sh() {
  case "$TARGET" in
    kindle)  kssh "$*" ;;
    android) adbs shell "$*" ;;
  esac
}

TARGET="${1:-}"; CMD="${2:-help}"
case "$TARGET" in
  kindle|android) shift 2 || shift $# ;;
  help|-h|--help|"") usage; exit 0 ;;
  *) die "first argument must be kindle or android (got: $TARGET)" ;;
esac

case "$CMD" in
  check)     cmd_check ;;
  deploy)    cmd_deploy "$@" ;;
  push)      cmd_push "$@" ;;
  restart)   cmd_restart ;;
  shot)      cmd_shot "$@" ;;
  tap)       cmd_tap "$@" ;;
  log-reset) cmd_log_reset ;;
  log)       cmd_log "$@" ;;
  wait-log)  cmd_wait_log "$@" ;;
  sh)        cmd_sh "$@" ;;
  help)      usage ;;
  *)         die "unknown command: $CMD (see ko.sh help)" ;;
esac
