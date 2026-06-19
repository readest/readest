---
name: tts-start-from-selection
description: TTS started-from-word-selection bugs — next-sentence start + lingering selection highlight
metadata:
  node_type: memory
  type: project
  originSessionId: tts-wordsync-drift
---

# TTS "Speak from selection" — started at next sentence + left the word selected

Workflow: select a word → annotation popup → headphone (TTS) icon. Path: `Annotator.handleSpeakText` → `eventDispatcher.dispatch('tts-speak', {range: selection.range, index})` → `useTTSControl.handleTTSSpeak` → `view.tts?.from(ttsFromRange)` (foliate). Quick-action (oneTime) uses `genSSMLRaw(range.toString())` instead.

## Bug 1 — starts from the NEXT sentence (foliate `from()`)
`packages/foliate-js/tts.js` `from(range)` picked the mark via "first mark whose start is at/after the selection":
```js
if (range.compareBoundaryPoints(Range.START_TO_START, range_) <= 0) { mark = name; break }
```
For a selection that is NOT the sentence's first word, `selection.start > mark.start` for the containing sentence → skipped → picked the NEXT sentence's mark. (First word worked; that's why it was intermittent.) Fix = pick the LAST mark starting at/before the selection (the containing sentence):
```js
for (const [name, range_] of this.#ranges.entries()) {
  if (range.compareBoundaryPoints(Range.START_TO_START, range_) < 0) break
  mark = name
}
```
`compareBoundaryPoints(START_TO_START, range_)` compares selection.start vs mark.start: 1=after, 0=equal, -1=before. Block selection above (`END_TO_START <= 0`) was already correct. `from()` returns SSML from the chosen mark to END of block (strips earlier sentences, keeps later ones) — assert start-of-text, not absence of later text.

## Bug 2 — selection stayed highlighted after TTS started
`handleSpeakText` never cleared the selection. Fix = in `Annotator.handleSpeakText`, pass `selection.range.cloneRange()` (clone so clearing the live selection can't disturb the start range) and call `view?.deselect()` right after dispatch. Do it in the Annotator (immediate), NOT in `handleTTSSpeak` (which only reaches the deselect after Edge init → laggy). `selection.range` is the LIVE range (`sel.getRangeAt(0)`, useTextSelector makeSelection). `view.deselect()` = `getSelection().removeAllRanges()` on every section doc (foliate view.js); handleStop already calls it on stop.

## Testing
- foliate `from()` unit-tested in `src/__tests__/document/tts.test.ts` (describe 'from() selection start'): mid-sentence / first-word / last-sentence cases. Build a word `Range` in a single-`<span>` paragraph and assert `stripTags(tts.from(range))` start.
- **jsdom gap:** `from()` calls `CSS.escape` (mark[name=…]); jsdom has no global `CSS`. `start()` tests dodge it (lastMark null → `#getMarkElement` early-returns). Added a standard `CSS.escape` polyfill to `vitest.setup.ts`.
- Live verified (dev-web, Chrome): select "fraught" mid-sentence-1 → highlights `Frowning·Li·Mutian's·mind·was·fraught·with·worries·At…` (started at sentence head, continued past) AND all section docs `getSelection()===''`. Dev server DID recompile the foliate workspace edit on reload (no manual restart needed this time, contra older notes). OPFS `NoModificationAllowedError` spam = book open in 2 tabs (user session + mine) → flaky `view.tts` (nulls after playback). Related: [[tts-word-highlight-singletextnode-drift]] [[edge-tts-word-highlighting-4017]].
