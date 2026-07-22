---
name: tts-sync-paragraph-rsvp-3235
metadata: 
  node_type: memory
  type: project
  originSessionId: c39202b7-d8c2-4150-a618-c31857a8ad73
---

#3235 "sync paragraph & speed reader with TTS" (PR #4576, branch `feat/tts-sync-paragraph-rsvp`). TTS is the clock; visual modes follow one-way (never drive TTS back). Fixed-layout gated off (indicator 'unsupported').

**Position bus.** `TTSController.#dispatchPosition(cfi, kind)` emits canonical `tts-position {cfi, kind:'word'|'sentence', sectionIndex, sequence}` (monotonic `#positionSequence`). `useTTSControl` forwards it +bookKey, plus `tts-playback-state {state}`. Followers drop stale events via `sequence <= lastSequenceSeen` (dispatch awaits listeners serially → out-of-order possible). Edge emits BOTH a per-sentence mark AND per-word boundaries; WebSpeech/Native emit sentence only.

**Cross-realm.** CFI anchors from `view.resolveCFI(cfi).anchor(doc)` are iframe-realm Ranges → top-realm `instanceof Range` is ALWAYS false. Use `isRangeLike` (`src/utils/range.ts`, duck-types `cloneRange`). See [[tts-sync-chrome-verification]] (this exact bug froze the follow; Edge TTS verify recipe lives there).

**In-mode audio toggle.** Both modes get a 🔊 toggle (IoVolumeHigh/IoVolumeMediumOutline) to start read-along from the focused word/paragraph. `buildParagraphTtsSpeakDetail` / `buildRsvpTtsSpeakDetail` build the `tts-speak` detail = `{bookKey, index(spine), range}`; range included ONLY when live (`range.startContainer.ownerDocument === currentDoc`) else dropped → TTS uses its own start. Session-active (playing OR paused) vs playing tracked separately so a pause keeps the indicator + layout ('paused' status); only a full stop clears.

**Current word/sentence highlight (the non-obvious part).** Paragraph overlay renders a CLONE of the paragraph (`range.cloneContents()` → `dangerouslySetInnerHTML`), so the iframe's TTS highlight is NOT visible there. Reproduce it on the clone with the **CSS Custom Highlight API**: `CSS.highlights.set('readest-tts-paragraph', new Highlight(range))` + a `::highlight(readest-tts-paragraph){…}` rule. Wins over `<mark>`-wrapping: no DOM mutation (clone markup + fade-in animation untouched), and it spans inline-element boundaries natively (sentence highlights). Supported in all targets (guard `CSS.highlights && typeof Highlight !== 'undefined'`, no-op else).
- Offsets computed in the hook (iframe realm) relative to the PARAGRAPH START via a pre-range `setStart(para.start) setEnd(target.start)` toString length (`computeParagraphHighlightOffsets`). They map 1:1 onto the clone's text because both the clone and the offsets start at para.start. Overlay rebuilds the clone-range with `getTextSubRange(base, start, end)` (reused from `src/services/tts/wordHighlight.ts`) where base = `selectNodeContents(.paragraph-content)`.
- Tag the highlight with the paragraph INDEX; the overlay effect applies it only when `highlight.index === focusIndex` so a stale highlight never paints the wrong paragraph (focus + highlight are separate dispatches). Effect deps include `paragraphs` so it rebuilds the range against fresh clone DOM.
- `::highlight()` style derived from `viewSettings.ttsHighlightOptions` via `buildTtsHighlightCssText` (highlight/outline → translucent `color-mix` bg; underline/squiggly/strikethrough → text-decoration). `::highlight` pseudo only supports color/background-color/text-decoration/text-shadow.

**kind-gating** (`decideParagraphTtsHighlight {kind, hasWordPositions}` → word|sentence|skip): word→'word'; sentence after words seen→'skip' (else the coarse sentence flickers over the current word); sentence w/ no words→'sentence'. `hasWordPositionsRef` reset on full stop. `applySyncCfi(cfi, highlight)` always selects the paragraph (so 'skip' still follows) and dispatches `paragraph-tts-highlight` only when highlight. RSVP shows ONE word so needs no highlight — mode-specific.

**Files.** `useParagraphMode.ts` (applySyncCfi, handlePosition kind-gate, pendingSync.kind, toggleTtsAudio), `ParagraphOverlay.tsx` (CSS.highlights effect + `paragraph-tts-highlight` listener + `::highlight` rule), `paragraphTts.ts` (pure helpers, unit-tested), RSVP mirror in `rsvp/RSVPControl.tsx`+`rsvpTts.ts`+`RSVPOverlay.tsx`, `TTSFollowIndicator.tsx`. SettingsDialog `!z-[10050]` to open over the RSVP overlay (z-[10000]).
