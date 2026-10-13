---
name: custom-tts-byok-258
description: "Issue #258 custom OpenAI-compatible TTS (BYOK, premium) + voice picker/Readest Voice listing rework — MERGED #6746 (9bafc1112); migration 027 + API deploy before clients"
metadata:
  node_type: memory
  type: project
  originSessionId: 4b6fab0b-3194-405a-b56d-89b028b7e410
  modified: 2026-10-12T18:09:21.589Z
---

#258 "custom TTS engine": built 2026-10-13 in worktree `/Users/chrox/dev/readest-feat-custom-tts` (branch feat/custom-tts), committed 3433f397e, rebased on origin/main 2ea1a5328, NOT pushed. chrox's calls: premium via Full Customization gate (`isCustomTTSAllowed` = `isCustomTranslatorAllowed`), MULTIPLE named services (not one).

Shape: `OpenAICompatibleSpeechProvider` (POST {baseUrl}/audio/speech, mp3, no word timings) behind one `BufferedTTSClient` (`ttsCustomClient`, id `custom-tts`); voice id `<serviceId>:<voice>`; per-service groups via new optional `SpeechProvider.groupVoices`; `cacheScope` folds model/baseUrl/instructions into the cache key. Synced as replica kind `custom_tts` (own Manage Sync category, apiKey encrypted).

**Why:** a new replica kind needs `docker/volumes/db/migrations/027_replica_custom_tts.sql` + API allowlist deployed BEFORE clients ship, or every insert fails.
**How to apply:** when this ships, flag the prod migration; TTSController must not import stores (pulls settingsStore/i18n into every controller import graph — broke edgeTTS/catalog tests); services getter is injected via `setCustomTTSServices` from useTTSControl. Related: [[handwriting-ink-6674]] (also has a pending prod migration).

2026-10-13 follow-ups (UNCOMMITTED on top of 3433f397e): voices now come from GET {baseUrl}/audio/voices (Kokoro-FastAPI; strings or {id,name}); fallback OpenAI voices; Voices field removed. Multilingual voices use lang `mul` (MULTILINGUAL_LANG in tts/types.ts) so the picker's choice persists (was silently ignored before: preference keyed by '' was never stored). Readest Voice now listed for everyone via `GET /api/tts/readest?all=1` (server change, needs deploy; signed-in old-server fallback still works), locked voices `disabled`; BufferedTTSClient.getAllVoices no longer overwrites per-voice `disabled`. Edge Multilingual/Expressive suffix -> `variant` badge; picker groups are an accordion (at most one open: picked, else current voice's, else first; tapping the open one folds it); order narration, custom, Readest, Edge, native, Web.
Local dev has no readest-voice worker: /api/tts/readest 500s ("Worker readest-voice not found"). Kokoro test server: 192.168.2.3:8880 (CORS open). Intermittent stop on Edge->custom switch with a 503 seen twice, not root-caused.
Readest Voice stability (chrox: "assume the service is always on, it's premium"): GET /api/tts/readest (both plan mode and ?all=1) reads the catalog ONLY, never the worker/binding (503 only CATALOG_UNAVAILABLE); client keeps last list in localStorage `readest-voice-catalog`, answers from it at once, refreshes in background, never clears it on any server answer. vitest.setup.ts stubs fetch for /tts/readest (controller tests otherwise hit the network and time out under load).

PR #6746 opened 2026-10-13 (3 commits on origin/main a5b93c806). Dev builds route Readest Voice to production (getReadestVoiceAPIBaseUrl). Locked Readest voices are tappable -> profile/login. Groups marked + named when holding the current voice.

2026-10-13 Xiaomi (368b0948) check of bd105c626: no Readest group for a signed-out reader because PROD lacks `?all=1` (old route 403 NOT_AUTHENTICATED) and no saved catalog -> empty group hidden. Seeded `readest-voice-catalog` showed greyed Plus/Pro voices; tap -> /auth?redirect. chrox's rule: Readest Voice engine init must NEVER check locks, always available; gate only on use (setVoice/setLang/fallback/server). Pushed 6e79c8fa9 (init always true; picker warmup only with a playable voice). Custom TTS + the Edge->custom 503 still unverified on device (phone signed out; custom needs premium). Kokoro handled 10 concurrent requests fine (not the 503 source).

MERGED 2026-10-13 as 9bafc1112; worktree removed. Still open: prod migration 027 + web deploy before the next app release; custom TTS + Edge->custom 503 not device-verified.
2026-10-13: chrox confirmed migration 027 + web deploy are live; prod GET /api/tts/readest?all=1 signed-out = 200, 27 voices (19 plus, 8 pro). Only open item: custom TTS + Edge->custom 503 device check.
