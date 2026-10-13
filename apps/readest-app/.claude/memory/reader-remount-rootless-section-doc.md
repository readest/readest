---
name: reader-remount-rootless-section-doc
description: "Returning to the reader (back from /auth, /user) reuses the open view; its section iframe reloads and doc.documentElement is briefly null, so any effect reading it throws and error.tsx hard-reloads the page (kills TTS)"
metadata:
  node_type: memory
  type: project
  originSessionId: 84b19bb0-a6e2-4b21-a02d-e95c48363e6d
  modified: 2026-10-13T14:04:07.542Z
---

2026-10-13, Xiaomi (fuxi): tapping a locked Plus voice in the TTS sheet routed to /auth; back on /auth
pushed /reader, the #6609 remount reused the still-open view, the section iframe reloaded
(about:blank -> about:srcdoc) and `createInkAnchoring` (handwriting re-anchor effect) destructured
`doc.documentElement` = null. The throw hit `src/app/error.tsx` and the whole document reloaded,
stopping TTS (which otherwise survives the detour via ttsSessionManager detach/adopt).

Fix MERGED #6758 (e4af64912, 2026-10-13) with the adopt fix below + lyric first-scroll: guard `!doc?.documentElement` in `inkAnchoring.ts`. Verified
on device with a `pnpm dev-android`-style build: no reload, TTS keeps playing after back.

Second defect, same detour: `FoliateViewer` only calls `setView(bookKey, view)` after
`await view.open()`, so the store keeps the old DETACHED view for the reused key meanwhile.
`useTTSControl`'s adopt grabbed it → controller bound off-screen → no sentence/word highlight
(page-follow still worked via the hook's live view). Fix: adopt only `view?.isConnected`; the 300ms
retry picks up the new view. Verified on device (CDP heap query for the TTSController's `view`).

**How to apply:** any code that reads a section `doc` from `view.renderer.getContents()` in a React
effect must tolerate a rootless document during reader remount. Repro recipe: signed-out, start
TTS, sheet -> voice -> Plus voice -> back arrow; watch via CDP (`webview_devtools_remote_<pid>`).
See [[plans-page-back-to-reader-6607]].
