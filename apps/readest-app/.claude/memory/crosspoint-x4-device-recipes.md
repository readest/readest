---
name: crosspoint-x4-device-recipes
description: "How to test the CrossPoint plugin on a real Xteink X4 from this Mac (screenshots, logs, file upload, flashing) plus firmware quirks that shaped PR #6561"
metadata:
  node_type: memory
  type: reference
  originSessionId: 526b8433-ef5f-4c69-ae0d-594bc58074bc
  modified: 2026-10-02T15:06:25.219Z
---

**Device:** Xteink X4 (ESP32-C3, no PSRAM, no USB mass storage) on CrossPoint nightly from crosspointreader.com/#flash-tools ("Insider → CrossPoint Nightly"; develop builds only, CI builds firmware only for PRs). SD card shows up as `/Volumes/CROSSPOINT` only in a card reader.

**Screenshot over USB:** port `/dev/cu.usbmodem*`; send `CMD:SCREENSHOT\n`, read `SCREENSHOT_START:<n>` then n raw bytes (800x480 1-bit, MSB first, rotate 90° CW for portrait). Use PlatformIO's python (`/opt/homebrew/Cellar/platformio/*/libexec/bin/python`, has pyserial). Open with plain `serial.Serial(port, 115200)`: setting DTR=False before RTS REBOOTS the C3 (RTS set + DTR clear = reset). Serial log is INFO only, so KOSync debug lines never show.

**Files without pulling the card:** start File Transfer on the X4; its IP is on screen. `curl --noproxy '*'` is required (shell http_proxy can't reach LAN). Uploads refuse to overwrite: `POST /delete` (form `path=`), then `POST /upload?path=<dir>` multipart; read back with `/download?path=`. Only wifi/opds/koreader .json are protected. `/api/settings` GET never returns koPassword.

**Firmware quirks:** plugins cannot write KOReader Sync from device.json (`auth` device_code signs in for browse/events only) → sign-in moved to the web card only. Its HTTP client reads a reply with no Content-Length and no chunking until close, so a relayed `204` times out (~30 s, relay 502) → never answer the device with an empty 204. UI fonts are Latin-only; CJK titles render blank unless an SD `.cpfont` family with sizes 8,10,12 is selected (converted LXGW WenKai GB Screen with `lib/EpdFont/scripts/fontconvert_sdcard.py --intervals latin-ext,cjk`).

**Prod request tail:** `npx wrangler tail readest-web --format json | jq` filtered on `/api/crosspoint` (path segments arrive REDACTED).

**PR #6561** MERGED (81403bc33), 3 CodeRabbit findings fixed; follow-up **#6570** MERGED (/link applies useTheme + bg-base-100; it showed light text over a dark window in dark mode). #6561 covered: web-only sign-in, revoke 200 JSON, button states, recently-read catalog, in-app /link (AASA `/link`, useOpenDeviceLink, clipper skip). Revoke fix + in-app link not device-verified (need deploy + app build).
