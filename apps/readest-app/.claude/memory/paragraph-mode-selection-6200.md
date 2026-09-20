---
name: paragraph-mode-selection-6200
description: "#6200 selection/highlight/lookup inside Paragraph Mode + resume at the exited paragraph; clone-in-host-doc bridged to the Annotator via the footnote popup-selection event; traps: reader page select-none, React 19 innerHTML reset on re-render, hidden Chrome MCP tab"
metadata: 
  node_type: memory
  type: project
  originSessionId: dcfecdbf-222c-48bc-8269-709bd596f394
  modified: 2026-09-17T20:40:25.729Z
---

Issue #6200 (FR: selection in Paragraph Mode). MERGED #6258 (6e23b2507, 2026-09-18), UNRELEASED;
worktree removed. Chrome-VERIFIED on the web build:
drag-select → toolbar, dictionary popup, red highlight created with a real CFI and visible on the
page after exit, Highlight again toggles it off, re-enter resumes at the exited paragraph.
NOT verified on Android/iOS.

**How it works:** ParagraphOverlay renders `range.cloneContents()` as HTML in the HOST document,
so the iframe selection listeners never see a selection there. The overlay watches
`document.selectionchange` (250ms debounce + immediate on `pointerup`) and dispatches the
Annotator's existing `footnote-selection` event with the CLONED host range (positions the
toolbar) plus a CFI mapped back onto the real paragraph by inert-skipping character offsets
(`paragraphSelection.ts` → `getTextSubRange(sourceRange, start, end)` → `view.getCFI`).
Popup-selection semantics apply: Read Aloud disabled, CFI tools use `selection.cfi`.

**Why:** three traps that cost the most time:
- The reader page root is `select-none`; the clone MUST carry `select-text` or nothing is selectable.
- React 19 re-sets `innerHTML` whenever the `dangerouslySetInnerHTML` object identity changes, so
  EVERY re-render of AnimatedParagraph rebuilt the clone DOM and collapsed any live Range in it
  (selection + TTS highlight ranges). Fix = `useMemo(() => ({ __html: html }), [html])`.
- Host-document selections collapse on ANY click, including toolbar buttons, so a collapsed
  selection is never a dismiss signal. Dismiss = tap on the overlay routed through
  `eventDispatcher.dispatchSync('iframe-single-click')` (the annotator's `isPopuped` oracle),
  paragraph change, Escape, overlay close. A click with the clone selection still live is the
  tail of the gesture and must be checked BEFORE the dispatchSync (CDP delivered a drag's mouseup
  5s late and its click killed the toolbar).

**Resume:** "starts from the first paragraph" = resumed at the PAGE-START paragraph because
`view.lastLocation.cfi` took priority (#4717 demoted the stored paragraph CFI as malformed).
Fix = remember `{ locationCfi: view.lastLocation.cfi, docIndex, index, text }` on exit and
`iterator.goTo(index)` when the text matches; no CFI round-trip for the paragraph. Keyed on the
LIVE location CFI (CodeRabbit: the store location is rAF-debounced and could restore a stale
paragraph after a same-section move); nothing relocates on a Paragraph Mode toggle so the CFI is
stable across exit/re-enter. Shift+Arrow yields to the browser whenever the selection is anchored
in the clone, caret included (second CodeRabbit finding).

**How to apply:**
- `pnpm test -- <file>` runs the WHOLE suite; use `pnpm exec dotenv -e .env -e .env.test.local -- vitest run <file>`.
- Chrome MCP tab showed `visibilityState: hidden` (rAF never fires, timers throttled, paragraph
  swaps arrive seconds late); activate it with AppleScript `set active tab index of w` before
  timing-sensitive checks. Set selections via JS `addRange` instead of CDP drags.
- Never `git checkout -- file` to strip test instrumentation; it reverted 360 lines of new tests once.
- The localhost:3000 dev library is the user's REAL logged-in account: highlights sync; remove them.
- Highlights ARE painted on the clone (chrox asked after trying it: no feedback otherwise):
  same-section notes resolved via `view.resolveCFI`, clipped to the paragraph
  (`getRangeOffsetsInParagraph`), mapped by inert-skipping offsets, painted with
  `CSS.highlights` under `readest-annotation-<style>-<hex>` + a `::highlight()` rule per group;
  keyed on `useBookDataStore` booknotes so create/delete repaint instantly. Chrome-VERIFIED.
  The B&W e-ink "white highlight" substitution is skipped on purpose (needs the page
  overlay's blend mode; invisible on the clone). Tests mock `@/store/settingsStore`
  (real store has no globalReadSettings until loaded).
- Still open: iOS native grabbers float over the dictionary sheet for host-doc selections
  (same as footnote popups).
