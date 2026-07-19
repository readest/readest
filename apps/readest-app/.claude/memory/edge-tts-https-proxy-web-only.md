---
name: edge-tts-https-proxy-web-only
description: Tauri apps must never fall back to the /api/tts/edge https proxy; it is a web-browser-only fallback
metadata: 
  node_type: memory
  type: project
  originSessionId: 576a5112-41af-4b4f-8edf-32d18d4feada
---

The authenticated `/api/tts/edge` https proxy exists only because browser WebSockets cannot send the headers Edge's wss endpoint requires (so web wss is intermittently blocked). On Tauri, wss goes through tauri-plugin-websocket with full headers — a wss failure there means offline or Edge is down, and the proxy fallback must NOT fire (2026-07: it fired on iOS airplane mode, producing cross-origin "access control checks" fetch errors to web.readest.com).

**Why:** Burns server proxy resources for no benefit and spams WKWebView CORS errors; offline Tauri should flow to cache-only init ([[tts-architecture-refactor-plan]] CachingProvider) or the native speech fallback.

**How to apply:** Both wss→https fallback sites are gated on `!isTauriAppPlatform()`: `EdgeTTSClient.init()` (src/services/tts/EdgeTTSClient.ts) and `fetchEdgeAudio` in src/services/tts/wordPronouncer.ts. Any new Edge transport fallback must keep this gate; tests pin it in edge-tts-client.test.ts and wordPronouncer.test.ts ("does not retry via the https proxy on Tauri").
