---
name: epub-undeclared-media-manifest-6227
description: "#6227 embedded <video> shows controls but 0:00 — the mp4 is in the zip but not in the OPF manifest, and foliate-js only had manifest-miss fallbacks for images and fonts; fix + repro recipe"
metadata: 
  node_type: memory
  type: project
  originSessionId: caa1508b-a1d4-4017-ab7d-5b318fc76b50
  modified: 2026-09-17T11:20:29.434Z
---

Issue https://github.com/readest/readest/issues/6227 ("FR: Support for built-in video playback", TOM-PIC). Readest rendered a real `<video>` with native controls but black / `0:00`; Neat Reader (web Chrome) and Koodo (Electron) played the same file, so **codec was never the problem**.

**Repro book:** `~/Documents/books/issues/6227/四百二十连败少女 ①.epub` (9.7 MB, epubBuilder 3.1.08.28 / cnepub, 2013). `OPS/chapter1.html` has `<video src="111.m4v" controls="controls"></video>`; `OPS/111.m4v` (5.4 MB, 2:25) is in the zip. **The OPF manifest declares only the chapters + `images/cover.jpg`** — not the m4v, and not any of the other illustrations.

**ROOT CAUSE (confirmed):** `Loader.loadHref` (`packages/foliate-js/epub.js`) looks the resolved path up in the manifest and, on a miss, falls back only to `tryImageEntryItem` / `tryFontEntryItem`. There was no audio/video probe, so `.m4v` returned the raw relative href `111.m4v`, which cannot resolve against the section's `blob:` document URL → media element with no source → controls render, `networkState` never reaches a loaded state, `0:00`. `tryImageEntryItem` exists precisely because this same builder omits images; video just never got the same treatment.

**Fix:** `tryAudioVideoEntryItem(path)` in `epub.js` next to the image/font probes, keyed on extension + the zip entry actually existing, wired into the `loadHref` fallback chain. `AUDIO_VIDEO_MEDIA_TYPES` map covers mp4/m4v/webm/ogv/mov + mp3/m4a/m4b/aac/oga/ogg/opus/wav/flac; `AUDIO_VIDEO_EXTENSIONS` is `Object.keys` of it so the two can't drift. The blob **type matters** — `createURL` builds `new Blob([data], {type: mediaType})`, and a wrong type is a second way to get a silent 0:00.

**Test:** `apps/readest-app/src/__tests__/foliate-epub-undeclared-media.test.ts`, modelled on `foliate-epub-resource-refcount.test.ts` (real `EPUB` over an in-memory zip, `URL.createObjectURL` stubbed to record `blob.type`). Covers `<video src>`, `<audio src>`, `<source src>` inside a `<video>`, and the negative case (href untouched when the zip has no such entry). 3 of 4 failed before the fix.

**Browser verification recipe (web dev server, no Playwright needed):**
- `pnpm dev-web`; the library page's drop listener is on **`.library-page`**, not `body` — dispatching a synthetic `DragEvent('drop')` on `document.body` is silently ignored (`src/app/library/hooks/useDragDropImport.ts`).
- CORS: copy the epub into `public/` and `fetch('/__foo.epub')` same-origin, then `new File([buf], name)` → `DataTransfer` → drop on `.library-page`. Delete the public copy afterwards.
- Reader iframes live in shadow roots; walk `el.shadowRoot` recursively and match `f.contentDocument.title` against the chapter title.
- Verified: `src` is `blob:http://localhost:3000/...`, `readyState 4`, `duration 145.914` (= the 2:25 the other readers show), `error null`, plays with `currentTime` advancing.

**Status:** foliate PR https://github.com/readest/foliate-js/pull/97 **MERGED** as a squash -> `c319c90` on main; the branch commit `3d02e98` is NOT an ancestor, so the submodule was re-pinned (`d1d178f43`). readest PR https://github.com/readest/readest/pull/6245 (branch `fix/epub-undeclared-media-6227`, off origin/main) OPEN, CI running. `pnpm test` 11114 passed, `pnpm lint` and `pnpm format:check` green. The squash-orphans-the-pin trap fired exactly as [[epub-embedded-video-kotobee-1812]] warned: always `git merge-base --is-ancestor <pin> origin/main` after a foliate PR merges

Related: [[epub-embedded-video-kotobee-1812]] (the *other* video failure mode — a script building `<video>` at runtime with a relative src, fixed by `observeDynamicResources`; that one needs "Allow JavaScript" on, this one does not).
