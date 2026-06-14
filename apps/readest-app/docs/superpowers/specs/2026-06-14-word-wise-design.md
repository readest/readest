# Word Wise — inline vocabulary hints for Readest

**Date:** 2026-06-14
**Status:** Design approved (pending spec review) → next is `writing-plans`
**Scope owner:** reader / dictionaries

---

## 1. Summary

Build the single core function of **Kindle Word Wise** into Readest: as the user reads,
a small **native-language gloss appears above difficult words**, inline in the text, with
no interaction required. A **difficulty slider** controls how many words get a hint (fewer =
only the rarest words; more = include easier words). **Tapping a glossed word opens
Readest's existing dictionary popup** for the full entry.

This is modeled on Kindle Word Wise. We build **only the inline-hint function** — explicitly
**not** SRS review decks, audio narration, or whole-book difficulty ("book fit") scoring.

### Locked product decisions
| Decision | Choice |
| --- | --- |
| Hint content | **Native-language gloss** (a short translation above the hard word) |
| Difficulty control | **Frequency slider** (Kindle-style: fewer ↔ more hints) |
| Book languages (v1) | **English + Chinese** source text (Japanese deferred — no JP analyzer) |
| Gloss data source | **Bundled offline dataset** (frequency-trimmed), lazy-loaded |
| Display | **Always-on inline** (DOM `<ruby>`), tap opens the existing dictionary popup |
| Occurrences | **Every occurrence** on the page, capped per section |
| Inert marker | **Reuse `cfi-inert`** as the single content-inert marker across CFI / search / TTS |

---

## 2. User-facing behavior

- A **Word Wise** settings panel (reader settings) with: an **Enable** toggle and a
  **difficulty slider** (5 levels: *fewer hints* … *more hints*).
- When enabled and the book's text language has a bundled gloss index:
  - Difficult words (rarer than the slider's threshold) render with a small muted gloss
    above them, e.g. `cryptic` → `晦涩的` (EN→中文), `斟酌` → `to consider` (中文→EN).
  - The gloss sits in native ruby position; the line spacing grows to fit, exactly like
    Kindle. No layout overlap.
  - Tapping a glossed word opens the existing dictionary popup for that word.
- When disabled, or for an unsupported book language, **no glosses render** and there is
  zero effect on layout, CFI, TTS, search, or selection.
- Settings persist **per-book and globally**, using the existing `saveViewSettings` path.

---

## 3. Architecture

New, isolated units. Each has one purpose, a small interface, and is independently testable.

```
src/services/wordwise/
  types.ts          # WordGloss, GlossEntry, GlossOccurrence, SupportedSourceLang
  glossIndex.ts     # lazy-load + cache per-source-language index; lemmatize(); lookup()
  difficulty.ts     # pure: sliderLevel -> rank cutoff; isDifficult(rank, cutoff)
  planner.ts        # pure: (sectionText, sourceLang, cutoff, index) -> GlossOccurrence[]
  index.ts          # thin service facade used by the reader

src/app/reader/utils/
  wordwiseRuby.ts    # inject/unwrap <ruby cfi-skip>…<rt cfi-inert>…</rt></ruby> into a section doc

src/components/settings/
  WordWisePanel.tsx  # toggle + slider (mirrors TTSPanel)

scripts/
  build-wordwise-data.mjs  # offline data-prep: source datasets -> trimmed assets + attributions

public/wordwise/
  en-zh.json         # trimmed gloss index, English source -> Chinese gloss
  zh-en.json         # trimmed gloss index, Chinese source -> English gloss
  ATTRIBUTION.md     # ECDICT (MIT), CC-CEDICT (CC-BY-SA), HSK list attributions
```

### Responsibilities / boundaries
- **`planner.ts`** is the heart and is **pure** (no DOM, no async): given the plain text of a
  section, the source language, the difficulty cutoff, and a gloss index, it returns a list of
  `GlossOccurrence { start, end, word, gloss }` (character offsets into the section text).
  It owns tokenization-dispatch (English vs CJK), inflection resolution, threshold filtering,
  and the per-section occurrence cap. **All the interesting logic lives here and is unit-tested
  without a browser.**
- **`glossIndex.ts`** owns data: lazy `load(sourceLang)` fetches `public/wordwise/<pair>.json`
  once, builds an in-memory `Map<string, GlossEntry>` plus an inflection reverse-map
  (`running → run`), and exposes `lemmatize(word)` and `lookup(lemma)`.
- **`wordwiseRuby.ts`** is the only DOM-mutating unit: given a live section `Document` and a
  `GlossOccurrence[]`, it maps offsets → DOM Ranges (reusing the section's text walk) and wraps
  each occurrence in `<ruby class="ww-gloss" cfi-skip>word<rt cfi-inert>gloss</rt></ruby>`. It
  also `unwrap(doc)` — removes every `.ww-gloss` and `normalize()`s — so toggling/recomputing
  is clean and idempotent.
- **`FoliateViewer`** orchestrates: on section `stabilized`, builds the section text, calls the
  planner, then the injector, per loaded content doc; on settings change, unwraps + recomputes
  or unwraps to disable. Tap handling routes clicks inside `.ww-gloss` to the dictionary popup.

---

## 4. Data: datasets, prep, format, sizes, licensing

The full source datasets are too large to ship. A **build-time prep script** produces compact,
frequency-trimmed indices that are **lazy-loaded only when the feature is enabled** (not in the
initial app bundle).

### English → 中文 (flagship): ECDICT
- **License:** MIT (redistributable with notice).
- **Full size:** ~760k entries, ~160–200 MB CSV — **not shipped raw**.
- **Fields used:** `word`, `translation` (Chinese), `frq` (COCA rank) / `bnc` (BNC rank),
  `exchange` (inflections, `/`-delimited), `tag` (exam tags, optional future use).
- **Difficulty metric:** `frq` (COCA, modern usage) primary, `bnc` fallback. Lower rank = more
  common = easier.
- **Trim:** top ~20k–50k headwords by `frq`, keep `{ word, frq, gloss }` where `gloss` is the
  first 1–2 short Chinese senses (the `translation` field truncated to a hint-length string).
- **Inflection map:** parse `exchange` into a reverse map `{ form: lemma }` so `"running"` resolves
  to `"run"` without storing every inflected form.
- **Estimated shipped size:** top-20k ≈ **1–3 MB** JSON, **< ~1 MB gzipped**.

### 中文 → English: CC-CEDICT + HSK
- **License:** CC-CEDICT is **CC-BY-SA** (ship attribution + the license; the derived asset is a
  share-alike work — acceptable). HSK level lists are open (GitHub).
- **Gloss:** CC-CEDICT entry, first short English sense.
- **Difficulty metric:** HSK level (1–9) as the primary tier; word frequency (SUBTLEX-CH / Jun Da)
  as a secondary ordering within/above HSK.
- **Tokenization:** existing **jieba** (`cutZh`) segments Chinese into words for lookup.
- **Trim:** top ~10k entries by frequency + full HSK list. **Estimated shipped size:** ~300 KB
  uncompressed, ~100 KB gzipped.

### Japanese — **deferred** (documented gap)
No Japanese morphological analyzer is bundled (jieba covers Chinese only); JMdict + JLPT exist but
kanji-only segmentation is insufficient (particles collide). Out of v1; revisit with mecab-wasm or
a kanji-only fallback later.

### Other native languages — **deferred**
Offline bilingual data for non-中文/EN pairs is sparse. The gloss layer is intentionally pluggable
so a **cached live-translation fallback** (reusing `src/services/translators`) can be added later
for arbitrary target languages without reworking the planner or renderer.

### Asset format
`public/wordwise/<src>-<tgt>.json`:
```jsonc
{
  "meta": { "source": "en", "target": "zh", "metric": "frq", "version": 1, "count": 20000 },
  "entries": { "run": { "r": 312, "g": "跑；经营" }, /* ... */ },   // r = rank, g = gloss
  "inflections": { "running": "run", "ran": "run", "runs": "run" }
}
```
- `glossIndex.load()` fetches once, hydrates `entries` into a `Map`, keeps `inflections` as a `Map`.
- Memory: ~20k short-string entries ≈ a few MB RAM; only when the feature is on.

---

## 5. Difficulty model & slider

- `WordWiseConfig.wordWiseLevel: number` — 5 steps, default 3. Slider label: *fewer hints ↔ more hints*.
- `difficulty.ts` maps `level → rankCutoff` **per source language**, e.g. (EN, by `frq`):
  | Level | Cutoff (gloss words with rank ≥ cutoff) | Effect |
  | --- | --- | --- |
  | 1 | ≥ 20000 | only the rarest words |
  | 2 | ≥ 12000 | |
  | 3 | ≥ 7000 | balanced (default) |
  | 4 | ≥ 4000 | |
  | 5 | ≥ 2000 | many hints |
  For 中文, the slider maps to an **HSK-level threshold** (e.g. level 1 = only HSK 7–9 / off-list;
  level 5 = HSK 4+). Exact cutoffs are tuned with sample books during implementation and documented
  in `difficulty.ts`.
- `isDifficult(rank, cutoff) = rank >= cutoff`. Words absent from the index (rank unknown) are
  treated as difficult **only** if a gloss exists (otherwise skipped — nothing to show).

---

## 6. Rendering — DOM `<ruby>` with `cfi-inert` (verified safe)

Each difficult-word occurrence is wrapped, after section load:
```html
<ruby class="ww-gloss" cfi-skip>word<rt cfi-inert>gloss</rt></ruby>
```

### Why this is CFI-safe (verified against `packages/foliate-js/epubcfi.js`)
- `cfi-skip` on `<ruby>` → `rawChildNodes` (epubcfi.js:199–203) **splices the wrapper out**,
  hoisting the word's text node up into the paragraph.
- `cfi-inert` on `<rt>` → `rawChildNodes` **removes the gloss subtree** entirely.
- `indexChildNodes` (epubcfi.js:222–235) **re-merges the now-adjacent text nodes** (`"The "` +
  hoisted `"quick"` + `" fox"`) into a single chunk.
- Both directions sum across the chunk: `nodeToParts` (278–294) hoists past skip wrappers and
  re-merges; `partsToNode` (262–269) resolves an offset into the multi-text-node chunk.
- **Result:** CFIs are byte-identical to the unwrapped baseline. Saved highlights, bookmarks, and
  progress are unaffected, and a CFI saved with Word Wise on resolves correctly with it off
  (and vice-versa). **No `epubcfi.js` change is required.**

### Layout / CSS
- Native `<ruby>` grows line-height and positions the gloss above the base word — no overlay math,
  no manual line-height bump, reflows natively on resize/page-turn.
- Extend `getRubyStyles()` (or add `getWordWiseStyles()`) in `src/utils/style.ts` with a `.ww-gloss`
  rule: small `rt` font (~0.5em), muted color, `user-select: none` (already present for `rt`, so the
  gloss is excluded from copy). E-ink: muted color must remain legible — verify under
  `[data-eink='true']`.
- Must not double-wrap: the planner skips any token already inside a book's own `<ruby>`
  (furigana/pinyin) to avoid nesting.

### Injection lifecycle
- **Inject** in `FoliateViewer`'s `stabilizedHandler` for each loaded content doc (mirrors the
  existing warichu relayout there). Multiview preloads adjacent sections — inject per content doc.
- **Recompute** on `wordWiseEnabled` / `wordWiseLevel` change: `unwrap(doc)` then re-inject.
- **Disable / book close:** `unwrap(doc)` (replace each `.ww-gloss` with its base text node and
  `normalize()`).
- Idempotent: re-running inject first unwraps, so there is never nested or stale ruby.

### Tap-to-dictionary
- Glossed words are real `.ww-gloss` elements → natural tap targets. The existing iframe click
  handler detects a target inside `.ww-gloss`, reads the base word, and opens the dictionary popup
  (`setShowDictionaryPopup(true)` with the word), reusing the full existing dictionary stack.

---

## 7. Keeping the gloss invisible to TTS / search / annotation matching

The gloss text must not be read aloud, matched by find-in-book, or fold into TTS word offsets.
CFI already ignores `cfi-inert`. The remaining text walkers are all reachable **without patching
foliate-js**:

1. **Shared reject filter — `src/utils/node.ts` `createRejectFilter`.**
   This helper builds the `nodeFilter` passed to foliate TTS (`TTSController.ts` → `view.initTTS`)
   **and** the search `acceptNode` (`SearchBar.tsx` → `view.search`). It already rejects
   `script`/`style` by default.
   **Change:** reject any element with the `cfi-inert` attribute (and its subtree) **by default** —
   one line, covers spoken text and find-in-book together. (`cfi-inert` is an injected, non-content
   marker; no real book content uses it, so a global default is safe and also correctly excludes
   foliate's own injected a11y skip-links.) Other text walkers with their own inline `acceptNode`
   (`globalAnnotations.ts`, `proofread.ts`, `simplecc.ts`) run at load **before** glosses are injected
   at `stabilized`, so they don't see the gloss; if any later proves to need it, it adopts the same
   `closest('[cfi-inert]')` check.

2. **Edge-TTS word highlighting — `src/services/tts/wordHighlight.ts` + `TTSController.ts`.**
   `prepareSpeakWords` (TTSController.ts:666) matches Edge boundary `words` against
   `range.toString()`, and `getTextSubRange` (wordHighlight.ts:64–71) walks `SHOW_TEXT` with **no
   filter**. Because the spoken `words` already exclude the gloss (via the filtered `nodeFilter`),
   both the matching text and the sub-range walk must also exclude it or offsets drift.
   **Change:** add a shared predicate `isInsideInert(node) = !!node.parentElement?.closest('[cfi-inert]')`;
   skip such text nodes in `getTextSubRange`, and replace `range.toString()` with a small
   `rangeTextExcludingInert(range)` that concatenates the same filtered text nodes. This keeps `text`,
   the walk, and `words` mutually consistent.

3. **(optional) `packages/foliate-js/overlayer.js:88`** highlight split-range `acceptNode` — reject
   `cfi-inert` so a highlight drawn across a glossed word doesn't extend over the gloss box. Cosmetic;
   include only if it shows in testing.

**Net foliate-js change: none required for correctness** (optional overlayer cosmetic only). All
isolation is readest-side.

---

## 8. Settings & persistence wiring

- **`src/types/book.ts`** — add `WordWiseConfig { wordWiseEnabled: boolean; wordWiseLevel: number }`
  and include it in the `ViewSettings` union.
- **`src/services/constants.ts`** — `DEFAULT_WORD_WISE_CONFIG = { wordWiseEnabled: false, wordWiseLevel: 3 }`
  and spread into the default view settings object.
- **Store** — no change: `getViewSettings`/`setViewSettings` (`readerStore.ts:331–362`) and the
  global+per-book merge already handle arbitrary `ViewSettings` keys; `saveViewSettings`
  (`src/helpers/settings.ts`) persists and applies.
- **`WordWisePanel.tsx`** — mirrors `TTSPanel`: `BoxedList` + `SettingsSwitchRow` (enable) +
  slider (`NumberInput` 1–5, or the existing slider primitive) for level. E-ink-correct primitives.
- **`SettingsDialog.tsx`** — register a `WordWise` tab (icon + label) and render `WordWisePanel`.
- **`FoliateViewer.tsx`** — add `wordWiseEnabled` + `wordWiseLevel` to the deps of the
  settings-application effect; recompute/unwrap accordingly.
- **i18n** — key-as-content `_()` for all UI strings; scanner extracts them.

---

## 9. Data flow

```
settings (enabled, level) ──┐
book text language ─────────┤
                            ▼
section 'stabilized' ─▶ build section text ─▶ planner(text, srcLang, cutoff, index)
                                                  │  (tokenize EN/CJK, lemmatize,
                                                  │   lookup, threshold, cap)
                                                  ▼
                                            GlossOccurrence[] ─▶ wordwiseRuby.inject(doc)
                                                                    │  (offsets→Ranges→<ruby>)
                                                                    ▼
                                                              glosses visible
tap on .ww-gloss ─────────────────────────────────────────▶ dictionary popup(word)
settings change / disable ────────────────────────────────▶ wordwiseRuby.unwrap(doc) [+ re-inject]
```

---

## 10. Performance & limits

- Index is in-memory after one lazy fetch; lookups are O(1) sync.
- One tokenize+lookup pass per section, only for **loaded** content docs.
- **Per-section occurrence cap** (e.g. 200) to bound DOM growth; `log()`/`console.warn` when capped
  (no silent truncation).
- Glossing every occurrence (Kindle-faithful); the cap is the only limiter.
- jieba init is async and already used elsewhere; planner treats "jieba not ready" as "no CJK glosses
  yet" and the `stabilized` re-run picks them up once ready.

---

## 11. Error handling / edge cases

- Index fetch fails → feature no-ops, single `console.warn`; reader unaffected.
- Unsupported book language (no index for source) → no glosses; the panel may show a one-line note.
- Native-language mismatch (e.g. a non-Chinese user reading English): v1 only has EN→中文, so glosses
  show Chinese; this is acceptable for v1's audience and the panel notes the active pair. (Generalized
  via the deferred live-translation fallback.)
- Book already uses `<ruby>` → skip those tokens (no nesting).
- Pre-paginated / fixed-layout books → skip (no reflow room); gloss only in reflowable EPUB/text.
- Vertical writing mode → v1 may disable Word Wise (ruby placement in vertical text is an edge case);
  decided during implementation, documented if disabled.

---

## 12. Testing (test-first)

Write failing tests first, then implement.

**Unit (vitest, no browser):**
- `planner.test.ts` — offsets correctness; threshold filtering by cutoff; inflection mapping
  (`running→run`); English whitespace tokenization; CJK path with a mocked `cutZh`; skip-inside-ruby;
  per-section cap behavior.
- `difficulty.test.ts` — `level→cutoff` mapping per language; `isDifficult` boundaries.
- `glossIndex.test.ts` — `lemmatize`/`lookup`/miss against a fixture index; lazy-load caches once.
- `epubcfi-ruby-inline.test.ts` — **the key correctness guarantee.** Mirror
  `epubcfi-inert.test.ts`/`epubcfi-skip.test.ts` but for **mid-text inline** ruby with text on both
  sides: `<p>The <ruby cfi-skip>quick<rt cfi-inert>x</rt></ruby> fox</p>` must produce CFIs identical
  to `<p>The quick fox</p>` in both `fromRange` and `toRange`. (Existing tests cover block wrappers and
  prepended skip-links only.)
- TTS gloss alignment — extend `tts-word-highlight.test.ts`: with a glossed sentence, the
  `cfi-inert`-skipping `getTextSubRange` + `rangeTextExcludingInert` keep word ranges aligned with the
  gloss-free boundary `words`.
- `createRejectFilter` — rejects `[cfi-inert]` subtrees (search/TTS reuse).

**Browser/integration (Playwright):**
- glosses render above difficult words when enabled; toggle off removes them and restores layout;
  tap on a glossed word opens the dictionary popup; an annotation made with Word Wise on still anchors
  correctly with it off (CFI regression guard).

**Verification gates (from `.agents/rules/verification.md`):** `pnpm test`, `pnpm lint`. Rust/Lua
gates not applicable (no `src-tauri`/koplugin changes expected).

---

## 13. File change list

**New**
- `src/services/wordwise/{types,glossIndex,difficulty,planner,index}.ts`
- `src/app/reader/utils/wordwiseRuby.ts`
- `src/components/settings/WordWisePanel.tsx`
- `scripts/build-wordwise-data.mjs`
- `public/wordwise/{en-zh.json,zh-en.json,ATTRIBUTION.md}`
- tests listed in §12

**Edited**
- `src/types/book.ts` — `WordWiseConfig` + `ViewSettings` union
- `src/services/constants.ts` — `DEFAULT_WORD_WISE_CONFIG` + default merge
- `src/components/settings/SettingsDialog.tsx` — register panel
- `src/app/reader/components/FoliateViewer.tsx` — inject/unwrap lifecycle + settings deps + tap routing
- `src/utils/style.ts` — `.ww-gloss` ruby styling
- `src/utils/node.ts` — `createRejectFilter` rejects `[cfi-inert]` by default
- `src/services/tts/wordHighlight.ts` — skip `[cfi-inert]`; `rangeTextExcludingInert`
- `src/services/tts/TTSController.ts` — use the inert-excluding text for word matching
- (optional) `packages/foliate-js/overlayer.js` — reject `cfi-inert` in highlight split

---

## 14. Phasing

1. **Data prep + index** — `build-wordwise-data.mjs`, ship `en-zh.json`; `glossIndex` + `difficulty`
   + `planner` with full unit tests (no UI yet).
2. **Rendering** — `wordwiseRuby` inject/unwrap; CFI inline-ruby test; `createRejectFilter` +
   `wordHighlight` inert handling with TTS test; `.ww-gloss` CSS.
3. **Wiring** — `WordWiseConfig` + defaults + `WordWisePanel` + `SettingsDialog`; `FoliateViewer`
   lifecycle + tap-to-dictionary; browser integration tests.
4. **CJK** — `zh-en.json` (CC-CEDICT + HSK), jieba path in planner, 中文 difficulty mapping.

**Deferred (out of v1):** Japanese; non-中文/EN native targets (live-translation fallback); SRS/audio/
book-fit.

---

## 15. Open questions / risks

- **Inline-ruby CFI transparency** is verified by reading the code but only block-wrapper cases are
  currently tested upstream — the new `epubcfi-ruby-inline.test.ts` is the gate that must pass before
  relying on it. *(Highest-priority risk; fully mitigated by the test.)*
- **Gloss truncation quality** (ECDICT `translation` → hint-length string) needs tuning against real
  books to stay short but useful.
- **Difficulty cutoffs** per level are first-cut; tune with sample EPUBs during phase 1.
- **Default-rejecting `cfi-inert` in `createRejectFilter`** is a behavior change to a shared helper;
  confirm no current caller relies on walking `cfi-inert` skip-links (they shouldn't — those are
  injected non-content).
