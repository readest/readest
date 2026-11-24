---
name: custom-tts-mimo-chat-completions
description: "Xiaomi MiMo Custom TTS goes through /v1/chat/completions, detected by host; merged 2026-10-20 (#6863, #6906), live-verified on web; macOS app not run"
metadata:
  node_type: memory
  type: project
  originSessionId: a2ffaca3-ea7f-4e8a-b0cd-449a2079eb38
  modified: 2026-10-20T08:05:38.842Z
---

Custom TTS sends any service on `xiaomimimo.com` (or a subdomain) to
`/v1/chat/completions`, whatever model or path the user typed; the URL comes from
`speechEndpoint()` in `src/services/tts/providers/openaiCompatible.ts`, which the editor's
Test error also shows. Merged as #6863 (community, reworked) and #6906 (strip a pasted
`/audio/speech` or `/audio/voices` suffix for every service).

**Why:** MiMo has no `/audio/speech`; the PR first gated on an exact model + `/v1` path, which
left voicedesign/typo/future models on the 404.

**How to apply:**
- Live-verified 2026-10-20 with the owner's MiMo key: provider code returned MP3 for `/v1`,
  bare host and `/v1/chat/completions` (zh 冰糖, en Mia + instructions); owner confirmed Test +
  book Read Aloud on dev-web. macOS app skipped at the owner's request. #6912 closed, #6913 closed.
- Known non-support, on purpose: root base URL without `/v1` for non-MiMo services (no `/v1`
  guessing), query strings in base URLs (Azure needs an `api-key` header anyway), MiMo
  voicedesign/voiceclone models (we always send a preset voice → MiMo 400).
- Related: [[custom-tts-byok-258]].
