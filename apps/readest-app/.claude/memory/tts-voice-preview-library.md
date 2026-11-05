---
name: tts-voice-preview-library
description: "Voice preview + Voice Library (default voice per language), MERGED #7322 (8e2270aba) UNRELEASED; open items OmniVoice gender, preview lane deploy"
metadata:
  node_type: memory
  type: project
  originSessionId: 32c14265-55a6-4fd1-91f6-08462bed77dd
  modified: 2026-11-03T20:36:09.556Z
---

Built 2026-11-04 in worktree `~/dev/readest-feat-tts-voice-preview` (branch feat/tts-voice-preview); PR #7322 squash-merged 2026-11-04 as 8e2270aba at head a481fbccc, rebased on #7314 (Linux Speech Dispatcher), so the Voice Library also lists Linux native voices.

What it is: Settings → TTS → "Voice Library" sub-page (language select from the library, fixed to the book's language in-book) + redesigned player voice list (shared `src/components/tts/VoiceList.tsx`): gender filter, gender badge, language/region subtitle, play button per row. Previews: `services/tts/voicePreview.ts` (providers synthesize, one primed `<audio>`; Web Speech/native speak directly; any playing session is `suspend()`ed = stop + 'stop-paused'). Picking after a preview passes `resume` to `handleSetVoice`. Default voice per language = `TTSUtils.setDefaultVoice` → `preferredClient-<lang>` + `<engine>-<lang>`; `TTSController.setLang` applies the language's engine.

Open items:
- OmniVoice voices have no gender: catalog is server-owned; the readest-voice worker's export_catalog.py must add `gender`. Kokoro gender is inferred from the id in `catalog.ts`.
- Readest Voice previews use a new `lane: 'preview'` on /api/tts/readest/stream (signed-in, any plan, 1 segment ≤400 chars, floor 6,000 chars/day). App-route only: the service still sees a 'listen' window under clientId `<client>:preview` (service contract unchanged). Needs the web deploy before apps can preview.
- Not verified: Readest Voice preview end to end (dev origins can't reach production), iOS native gender (Swift only parsed), Android, Linux previews.

Why: the user asked for voice-picker previews in the style of dedicated TTS apps (2026-11-04) and chose: capped preview lane for all signed-in readers, preview pauses reading, sub-page from a row.

How to apply: after the web deploy, check a Readest Voice preview end to end on production; re-check the open items; see [[desktop-dev-window-webdriver-recipe]] for how it was verified.

Previews play at the player's speed: MERGED #7345 (a3517c31e) UNRELEASED, session rate else saved global rate, no unit test by owner's choice. Not verified: system voices on Android/iOS/Linux, real Edge and Readest Voice audio, WebKit keeping `playbackRate` after a source change. Known gap: before reading starts, a book with its own saved rate previews at the global rate.
