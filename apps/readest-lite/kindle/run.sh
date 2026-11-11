#!/bin/sh
# Readest Lite on a Kindle (from KUAL, or over SSH): a full-screen window on the Kindle's own X
# server, whose UI keeps running underneath. Close it with Readest's close button.
# The library, settings and temporary files stay in /mnt/us/readest-lite (/tmp is in /var, a
# 64 MB RAM disk); Import starts in /mnt/us/documents.
EXT=$(cd "$(dirname "$0")" && pwd)
DATA=/mnt/us/readest-lite
mkdir -p "$DATA/tmp"
SIZE=$(sed -n '1s/^U:\([0-9]*x[0-9]*\).*/\1/p' /sys/class/graphics/fb0/modes)

# No screensaver while Lite is open; on exit, put back what the reader had (the ~ds command, say).
SAVER=$(lipc-get-prop com.lab126.powerd preventScreenSaver 2>/dev/null)
lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null
HOME="$DATA" TMPDIR="$DATA/tmp" DISPLAY=:0 \
	BLITZ_TAURI_WINDOW=1 BLITZ_TAURI_SIZE="${SIZE:-1072x1448}" BLITZ_TAURI_SCALE="${READEST_LITE_SCALE:-2}" \
	BLITZ_TAURI_WM_NAME='L:A_N:application_ID:com.bilingify.readest-lite_PC:N_O:U' \
	BLITZ_FONTS="$EXT/fonts" READEST_LITE_DOCUMENTS=/mnt/us/documents READEST_LITE_EINK=1 \
	"$EXT/bin/readest-lite" "$@" > "$DATA/readest-lite.log" 2>&1
lipc-set-prop com.lab126.powerd preventScreenSaver "${SAVER:-0}" 2>/dev/null
# the window under Lite (KUAL's, say) does not repaint by itself: show Home
lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home 2>/dev/null
