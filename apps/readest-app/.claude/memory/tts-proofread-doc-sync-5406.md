---
name: tts-proofread-doc-sync-5406
description: "#5406 TTS ignored display proofread rules after section auto-advance; createDocument bypasses the transformTarget 'data' pipeline; fix replays it for TTS docs (PR #5416)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 267a782f-62cc-422f-ad46-e269856f7332
  modified: 2026-07-31T16:58:02.111Z
---

Issue #5406 (FR: TTS should sync with proofread replacement rules, incl. regex). PR #5416 MERGED 2026-07-31 (branch `fix/tts-proofread-doc-sync-5406`; worktree removed).

**Root cause, non-obvious:** `section.createDocument()` (epub.js `loadDocument`) parses the raw resource and bypasses the Loader's `data` event on `book.transformTarget`, which is where ALL display content transformers run (FoliateViewer `getDocTransformHandler`: proofread, simplecc, punctuation, whitespace, nbsp, ...). TTSController used raw docs in three paths:
1. `#initTTSForSection` auto-advance: `currentSection` was captured BEFORE `await onSectionChange`, so after navigating it always took the raw-doc branch — every auto-advanced section was spoken untransformed.
2. `attachView` fallback when the remounted view's primary is not the TTS section.
3. Downloader `enumerateSection` (cache keys diverged from playback).

Highlights map TTS-doc ranges into the live doc via `view.getCFI` + `resolveCFI().anchor()` under a content-identical assumption, so a rule that adds/deletes text made offsets drift — the reported "TTS不同步" symptom.

**Fix shape:** `src/services/tts/transformDoc.ts` `transformTTSSectionDocument(book, sectionId, doc)` — serialize doc, dispatch a synthetic `data` CustomEvent on `book.transformTarget` (detail `{data, type, name}`; handler replaces `detail.data` with a promise; `''` = handler error fallback), reparse. Exact display pipeline + viewSettings closure, zero transformer-list duplication. Plus `#getLiveSectionDoc` re-queries rendered contents AFTER `onSectionChange` and scans ALL contents (multiview preloads), not just primary.

**MD books (fixed in the same PR):** `utils/md.ts` had no `transformTarget`, so display transforms never applied to MD at all. Now: MD book exposes a `transformTarget` + sections gain `loadContent()` (paginator renders it via srcdoc when defined, same as EPUB) with per-section cache invalidated by `unload()` (paginator unloads on view destroy, so the recreateViewer a rule change triggers re-transforms). Non-obvious contract: `createDocument()` must stay RAW — TTS's transformTTSSectionDocument dispatches the pipeline itself and a pre-transformed doc would double-apply; and the dispatch `name` must be the bare section index because selection rules compare TOC-style `sectionHref` ("<index>#<anchor>") via `split('#')[0]`. Note: FoliateViewer never removes its 'data' listener from transformTarget, so viewer recreation stacks handlers (known #5277 hazard, transformers are de facto idempotent).

**Related facts:**
- mobi sections have numeric `id` and mobi's own `data` dispatch sets no `name`; selection-scoped proofread rules key off `detail.name` (epub: item.href).
- `onlyForTTS` rules are a separate path: applied to SSML in `useTTSControl.preprocessSSMLForTTS` (book/library scope only). Display rules reach TTS via the doc; both regex and plain.
- [[proofread-rule-change-font-loss-5277]] [[tts-fixes]]
