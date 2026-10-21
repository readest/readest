---
name: edge-tts-msedgeservices-endpoint-6722
description: "Edge TTS moved to api.msedgeservices.com (Ocp-Apim-Subscription-Key, Sec-MS-GEC v2 since #6751) after regional 403s"
metadata:
  node_type: memory
  type: project
  originSessionId: ce57291d-8010-471a-b6b9-2c9a76d82456
  modified: 2026-10-11T19:43:57.675Z
---

2026-10-10 Microsoft began rejecting the WebSocket handshake on `speech.platform.bing.com` with 403 in many regions (rany2/edge-tts#490; EU/ZA/PK first, US still fine). PR #6722 (MERGED 2026-10-12) switched `src/libs/edgeTTS.ts` to `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1` with the key as `Ocp-Apim-Subscription-Key`. The legacy `Sec-MS-GEC` (64 hex) + `Sec-MS-GEC-Version=1-143.0.3650.75` still work there. Sending the key as `TrustedClientToken`, or claiming version `2-155…` with the v1 token, both get 403.

**v2 token:** MERGED #6751 (2026-10-13): `generateSecMsGec` now sends v2 tokens with `Sec-MS-GEC-Version=2-…`. Keep algorithm details out of public text (chrox: summary only, no upstream link in the PR).

**How to apply:** for Edge TTS 403 reports, first check whether the host or token enforcement changed again. Verify on Android by deleting `AppCache/tts-cache/<book_hash>` via CDP `plugin:fs|remove` (baseDir 16) plus a force-stop, since cached audio masks network failures. The phone's VPN logcat (`KLNEKit ... target=<host>`) shows which host was hit. A JS `__TAURI_INTERNALS__.invoke` hook did NOT see the websocket plugin's connect calls.
