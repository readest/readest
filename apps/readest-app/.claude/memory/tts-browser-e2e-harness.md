---
name: tts-browser-e2e-harness
description: How to build a faithful TTS auto-advance browser e2e test (real view + real useTTSControl + mock client only)
metadata: 
  node_type: memory
  type: project
  originSessionId: fc8905a6-43fb-4e61-ae78-a2081098f6bb
---

Recipe + gotchas for `src/__tests__/services/tts-auto-advance.browser.test.tsx` — a real-Chromium browser test that mounts the real foliate `<foliate-view>` + real `TTSController` + real `useTTSControl` hook and mocks ONLY the speech client. Verifies TTS reading from the last paragraph of Ch4 auto-advances into Ch5, the page turns, and the "Back to TTS Location" badge never appears (TTS location stays in view).

**Why a browser test, not jsdom:** real page-turn needs real layout. Unit config (`vitest.config.mts`) excludes `**/*.browser.test.{ts,tsx}`; browser config (`vitest.browser.config.mts`) includes them — name the file `*.browser.test.tsx` and it routes to the right runner automatically.

**The only seam = the speech client.** `vi.mock` the three modules (`WebSpeechClient`/`EdgeTTSClient`/`NativeTTSClient`) returning a mock from a hoisted `function` (so vi.mock factories can reference it). The mock's `speak()` is tiny because `TTSController.#speak` only reads the event `code`: when last code is `end` it calls `forward()`, and the REAL `view.tts` walks the REAL document to the next sentence / across the section boundary. So:
```ts
speak: async function* (_ssml, signal, preload) {
  if (preload) return;            // preloadSSML iterates the generator — emit nothing on preload
  await sleep(25);                // lets React flush + relocate run between sentences
  if (signal.aborted) return;
  yield { code: 'end' };
}
```
`supportsWordBoundaries()` → false (sentence path; word path needs the client to emit boundaries). Keep `parseSSMLMarks`, `foliate-js/tts.js`, ssml, overlayer all REAL (do NOT mock them — that's what [[tts-fixes]]-style unit tests do, but here we want the genuine walk).

**Mock the contexts, keep the stores real.** `useEnv`/`useAuth` throw outside providers → `vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig:{}, appService: null }) }))` (+ AuthContext `useAuth: () => ({ user: null })`). `appService: null` is fine — all mobile/iOS branches in `useTTSControl`/`useTTSMediaSession` are null-guarded, and `getMediaSession()` returns the real `navigator.mediaSession` (not `TauriMediaSession`) in Chromium so the heavy branch is skipped.

**Seed stores directly (skip the heavy `initViewState`):**
- `useReaderStore.setState` → `viewStates[bookKey]` with all `ViewState` fields, `isPrimary: true`, `view`, `viewSettings`.
- `useBookDataStore.setState` → `booksData[id]` = `{ id, book:{title,author,coverImageUrl,primaryLanguage:'en'}, file:null, config, bookDoc, isFixedLayout:false }`. `id = bookKey.split('-')[0]`.
- GOTCHA: `useSettingsStore` defaults `settings: {} as SystemSettings`, so `proofreadStore.getMergedRules` → `settings.globalViewSettings.proofreadRules` throws → the speak chain rejects → `controller.error` → state `stopped` → it never crosses sections (symptom: stuck at the start section). FIX: `useSettingsStore.setState({ settings: { ...s.settings, globalViewSettings: viewSettings } })`.
- `setProgress` early-returns unless BOTH `viewStates[key]` and `booksData[id]` exist; only `isPrimary` writes `ttsLocation`/config.

**Reproduce FoliateViewer's `relocate → setProgress` glue** (the one production bit not under test) so `useBookProgress` updates on every page turn — that's what drives the badge effect. Copy `commitRelocate` (`detail.cfi/tocItem/pageItem/section/location/time/range`, `atEnd` → last page). Synchronous (skip the rAF batching) is fine and more deterministic.

**Navigation API:** index nav is on the RENDERER (`view.renderer.goTo({ index })`, `view.renderer.next()/prev()` return Promises). `view.goTo(href)` takes an href/cfi STRING. Initial display via `view.goToFraction(0)` after `view.open(bookDoc)` + `renderer.setAttribute` (max-column-count 1, sizes, margins, gap) in a fixed-size container appended to body.

**sample-alice.epub spine (all linear, 0-based sections):** 0 cover · 1 title · 2 about · 3 main0=Ch1 · 4 Ch2 · 5 Ch3 · **6 main3=Ch4** · **7 main4=Ch5** … Ch4/Ch5 are adjacent — the boundary to cross. `hydrateBookNav(bookDoc, await computeBookNav(bookDoc))` (from `@/services/nav`) before `view.open` so relocate's `tocItem.label` carries "Chapter N …" → assert `getProgress().sectionLabel` matches `/Chapter 5/`.

**Drive + assert** with `renderHook(useTTSControl)` + `act`: navigate to Ch4 last page (goTo index 6, then `renderer.next()` until primaryIndex !== 6, then one `prev()`), dispatch `eventDispatcher.dispatch('tts-speak',{ bookKey, index:6 })`, poll `result.current.showBackToCurrentTTSLocation` (track "ever true") until `view.renderer.primaryIndex === 7`, settle ~700ms, then assert: primaryIndex 7, sectionLabel /Chapter 5/, `resolveCFI(ttsLocation).index === 7`, badge `false` and never appeared. Assert BEFORE `tts-stop` (handleStop resets the badge flag to false, making a post-stop assertion meaningless). Cross-section page turn is driven by the controller's `onSectionChange` callback (wired in the constructor, not the effect) so it's robust to the effect-registration race.

Related: [[tts-fixes]], [[edge-tts-word-highlighting-4017]], [[android-cdp-e2e-lane]].
