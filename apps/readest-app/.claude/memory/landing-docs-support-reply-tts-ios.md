---
name: landing-docs-support-reply-tts-ios
description: "Support case TTS-IOS-01 exposed two Listen-docs errors; how TTS actually starts and picks voices, and the readest-landing docs edit recipe"
metadata: 
  node_type: memory
  type: project
  originSessionId: fa50820b-e361-4dee-85c0-93aeee148071
  modified: 2026-09-06T05:00:07.244Z
---

Support case TTS-IOS-01 (iPhone): docs said "press `T` or tap the speaker icon in the top toolbar" and "iOS uses the system voices". Both wrong for the app as shipped.

**Ground truth (verified in code 2026-09-06):**
- TTS starts from the headphones icon in the BOTTOM toolbar on every platform (`footerbar/NavigationBar.tsx` mobile, `DesktopFooterBar.tsx`). `t` is only a keyboard shortcut (`src/helpers/shortcuts.ts`).
- Default engine = `availableClients[0]` in `TTSController.init` = Edge TTS whenever it inits (online), on iOS/Android too. Native is never picked on its own.
- Voice/engine choice lives ONLY in the expanded Read Aloud player (mini player cover/title -> `TTSPlayerSheet` -> Voice), grouped "Edge TTS" / "System TTS" (iOS native groupId = `default`). Settings -> TTS has highlighting, speech, media info, audio cache only.
- Native picks the FIRST system voice for the language (`NativeTTSClient.getVoiceIdFromLang`), not the iOS Spoken Content default voice. Possible follow-up: honor `AVSpeechSynthesisVoice(language:)` when no preferred voice is stored.

**Landing docs recipe** (`~/dev/readest-landing`, branch `dev`): edit `src/app/[locale]/docs/<slug>/page.mdx`, bump `lastModified` for that slug in `docs/_nav.ts`, run `pnpm generate:llms` (regenerates the TRACKED `src/app/llms-full.txt/_content.ts`), then `pnpm test && pnpm lint`. `pnpm format:check` has 7 pre-existing failures in legal/blog/sync MDX; ignore unless touched. Listen page fix = readest-landing PR #35 (branch `docs/listen-tts-start-and-voice-picker`, e02df9d) MERGED 2026-09-06.

**Why:** the same two questions will recur as long as Edge is the silent default on iOS.
**How to apply:** for TTS support mail, point users to the player's Voice button, never to Settings; keep the docs and this note in step if the default-engine logic changes.
