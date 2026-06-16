---
name: global-annotation-pageturn-perf-4575
metadata: 
  node_type: memory
  type: project
  originSessionId: 4640857e-9c37-4ec6-890a-8aa20ec3a3f3
---

**#4575** — "after highlighting several main-character names, page turning is very laggy" (Chinese web-novel TXT). Root cause = the **global highlight** feature (highlight-all-occurrences, `note.global`), NOT plain highlights. The `progress` effect in `Annotator.tsx` (`for (const a of annotationIndex.globals) expandAllRenderedSections(view, a)`) re-fans-out EVERY global note across EVERY rendered section on EVERY page turn. Each pass: TreeWalker over the section DOM (`findTextRanges` in `globalAnnotations.ts`) + `view.getCFI(index, range)` per occurrence (~0.2ms each, the dominant cost) + `overlayer.add` which removes+recreates an SVG and calls `getRects` (forces layout). Overlays already exist after pass 1 → pure waste.

**Profiled live** (dev-web + claude-in-chrome, real `<foliate-view>`): 6 names / 226 occurrences across 2 rendered chapters = **~25–45ms synchronous main-thread per page turn** on desktop (×3–5 on mobile = the lag). Leads 姜窈(73×) 驰厉(66×) per 2 chapters.

**Fix (PR branch `fix/global-annot-pageturn-4575`, commit f1404c6b1):** module-level `WeakMap<Document, Map<noteId, signature>>` `expandedByDoc` in `globalAnnotations.ts`. `expandGlobalAnnotation` skips when `docMemo.get(note.id) === signature`; records after expanding (even 0 matches). `signature = updatedAt:style:color:text`. `removeGlobalAnnotationOverlays` clears the memo entry. Turns 2..N → ~0ms; one-time cost stays at section-render (`onCreateOverlay`). 5 unit tests in `src/__tests__/utils/global-annotations.test.ts`.

**Correctness invariant:** `doc` & `overlayer` are created/destroyed together per section content-record, and `getContents()` returns STABLE doc/overlayer refs across separate calls (verified). So "same doc ⟺ overlays still present" — a re-rendered section gets a fresh `doc` → memo miss → re-expand; never wrongly skips.

**Secondary complaints in the issue (NOT fixed here):** slow TXT import (`txt.ts` parse, "2MB should be instant"), slow TOC/notes open. Separate concerns.

**Repro recipe — import a GBK TXT into dev-web without the native picker:** copy the .txt into `public/`, then in-browser `fetch('/file.txt')` → `arrayBuffer` → `new File([buf], '原名.txt')` → `DataTransfer` → dispatch a synthetic `drop` `DragEvent` (with `Object.defineProperty(ev,'dataTransfer',{value:dt})`) on `.library-page`. Raw bytes preserved → app's encoding detection handles GBK. Books at `/Users/chrox/Documents/books/issues/4575/`. See [[tts-sync-chrome-verification]] for the live-foliate-view profiling pattern.
