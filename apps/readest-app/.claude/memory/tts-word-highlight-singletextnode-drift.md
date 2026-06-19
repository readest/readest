---
name: tts-word-highlight-singletextnode-drift
description: Edge TTS word highlight drifts/garbled on middle sentences of single-text-node paragraphs
metadata:
  node_type: memory
  type: project
  originSessionId: tts-wordsync-drift
---

# Edge TTS word highlight drift — `rangeTextExcludingInert` ignored range offsets (single text node)

**Symptom.** In Edge TTS word-by-word mode, the 1st sentence of a paragraph highlights correctly, but the **2nd/3rd (middle) sentences are "skipped"** — actually garbled: word highlights land on shifted fragments (`spoken "Those"` → `highlighted "if th"`, `"they're"`→`"y're on s"`). Last sentence works again. Book: "The Mirror Legacy" (each `<p>` wraps all text in ONE `<span>` = one text node).

**Root cause.** `rangeTextExcludingInert` (`src/services/tts/wordHighlight.ts`) had a single-text-node fast path `if (root.nodeType===TEXT_NODE) return root.data` that **ignored `base.startOffset`/`base.endOffset`** — returning the WHOLE paragraph text. `computeWordOffsets` then matched the sentence's Edge boundary words against the full paragraph (offsets relative to paragraph start), but `getTextSubRange` (the sibling that paints the highlight) DOES honor offsets (slices `[startOffset,endOffset]`). The mismatch shifts every word by the sentence's start offset within the node → drift.

**Why only middle sentences.** `getBlocks`/segmenter ranges: 1st sentence's range starts at the `<p>`'s leading-whitespace text node, last sentence's extends into trailing whitespace → both span MULTIPLE text nodes → `commonAncestorContainer` is `P`/`BODY` → multi-node path (correct). Middle sentences sit entirely inside the single `<span>` text node → `commonAncestorContainer` is that `TEXT_NODE` → buggy path. (Verified live: entry 0 cac=`P` ✓, entries 1&2 cac=`TEXT_NODE` ✗ returned 332-char full para, entry 3 cac=`BODY` ✓.)

**Fix (PR/commit on `dev`).** In the TEXT_NODE branch: `return (root as Text).data.slice(base.startOffset, base.endOffset)` (keep the `isInertText(root)` → `''` guard first). Mirrors `getTextSubRange`'s single-node handling.

**Scope.** Edge-only. `rangeTextExcludingInert` is used ONLY by `TTSController.prepareSpeakWords`, called ONLY by `EdgeTTSClient.#startWordTracking`. WebSpeech & Native report `supportsWordBoundaries()=false`, never compute word offsets; they sentence-highlight via `setMark`→`#getHighlighter` using the Range directly (unaffected). The `words.length===0` fallback also highlights via the Range, not this fn.

**Dev debuggability added (same change).** Dev-only trace in `prepareSpeakWords`: `console.log('[TTS] word-sync', {sentence, words:[{spoken,highlighted}]})`, gated by `process.env.NODE_ENV!=='production'` (DCE'd in prod). One log per sentence; a drift shows as `{spoken:'Those', highlighted:'if th'}`, an empty `words` shows missing boundaries. User chose gated-console-logging + dev-build-only over a window inspector / settings toggle.

**Chrome verify recipe.** Direct browser WSS to `speech.platform.bing.com` is blocked from localhost (Chrome UA/origin) → `wserr`; app's Edge path still works in-tab (authenticated `/api/tts/edge` https proxy). Start TTS at a chosen paragraph via **select a word → popup toolbar headphone icon** (`tts.from(range)`), not the global Speak (which starts at page top). Overlayer highlight calls are the ground truth: patch `content.overlayer.add/remove` (`fv.renderer.getContents()`) to log painted ranges — garbled fragments are unmistakable there. Related: [[edge-tts-word-highlighting-4017]] [[tts-sync-paragraph-rsvp-3235]].
