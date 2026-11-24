#!/bin/bash
# android.sh <cmd> [args] — drive Readest on YOUR emulator (never one another session started).
# Env: ANDROID_SERIAL (required), QA_DIR (screenshots in $QA_DIR/shots), DPR (CSS->device px,
# 2.625 on pixel_7), CDP_PORT (host port for the WebView, default 9256), ADB.
#   check                    device, Android/WebView version, Readest version + install time, pid
#   fwd                      forward CDP_PORT to the Readest WebView (re-run after every app restart)
#   shot NAME                screencap -> $QA_DIR/shots/a-NAME-full.png + 540px a-NAME.png; prints md5
#   tap X Y                  tap at CSS px
#   swipe X1 Y1 X2 Y2 [MS]   swipe in CSS px (default 300 ms)
#   key KEYCODE              input keyevent (KEYCODE_VOLUME_DOWN, KEYCODE_BACK, ...)
#   js 'EXPR'|FILE           Runtime.evaluate in the WebView over raw CDP (async body; use return)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
: "${ANDROID_SERIAL:?set ANDROID_SERIAL to your own emulator, e.g. emulator-5556}"
export ANDROID_SERIAL
ADB=${ADB:-${ANDROID_HOME:-$HOME/dev/android-sdk-linux/sdk}/platform-tools/adb}
DPR=${DPR:-2.625}; CDP_PORT=${CDP_PORT:-9256}; PKG=com.bilingify.readest
px() { python3 -c "import sys; print(*[round(float(v)*$DPR) for v in sys.argv[1:]])" "$@"; }
cmd=${1:-help}; shift || true
case $cmd in
  check)
    echo "device: $($ADB shell getprop ro.product.model) / Android $($ADB shell getprop ro.build.version.release)"
    echo "webview: $($ADB shell dumpsys webviewupdate | grep -m1 'Current WebView package' | tr -d '\r')"
    $ADB shell dumpsys package $PKG | grep -E 'versionName|lastUpdateTime' | tr -d '\r'
    echo "pid: $($ADB shell pidof $PKG | tr -d '\r')" ;;
  fwd)
    pid=$($ADB shell pidof $PKG | tr -d '\r'); [ -n "$pid" ] || { echo "Readest is not running" >&2; exit 1; }
    # Host ports are shared by every emulator: never take one forwarded for another device.
    owner=$(env -u ANDROID_SERIAL $ADB forward --list | awk -v p="tcp:$CDP_PORT" '$2 == p { print $1 }')
    if [ -n "$owner" ] && [ "$owner" != "$ANDROID_SERIAL" ]; then
      echo "port $CDP_PORT is forwarded for $owner (another session?); pick another CDP_PORT" >&2; exit 1
    fi
    [ -z "$owner" ] || $ADB forward --remove tcp:$CDP_PORT
    $ADB forward --no-rebind tcp:$CDP_PORT localabstract:webview_devtools_remote_$pid >/dev/null && echo "CDP $CDP_PORT -> pid $pid" ;;
  shot)
    : "${QA_DIR:?set QA_DIR}"; O=$QA_DIR/shots; mkdir -p "$O"
    $ADB exec-out screencap -p > "$O/a-$1-full.png"
    convert "$O/a-$1-full.png" -resize 540x "$O/a-$1.png"
    echo "$O/a-$1.png $(md5sum < "$O/a-$1-full.png" | cut -c1-12)" ;;
  tap) $ADB shell input tap $(px "$1" "$2") ;;
  swipe) $ADB shell input swipe $(px "$1" "$2" "$3" "$4") "${5:-300}" ;;
  key) $ADB shell input keyevent "$1" ;;
  js) CDP_PORT=$CDP_PORT timeout 30 node "$HERE/cdp.mjs" "$1" ;;
  *) sed -n '2,14p' "$0" ;;
esac
