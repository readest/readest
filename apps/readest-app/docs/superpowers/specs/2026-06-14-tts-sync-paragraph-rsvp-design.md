<!-- /autoplan restore point: /Users/chrox/.gstack/projects/readest/autoplan-restore-tts-sync-20260614-024952.md -->
# Sync paragraph mode & speed reader with TTS (#3235)

## Problem

Readest has three independent reading aids that don't talk to each other:

- **TTS** (read-aloud) — now emits per-**word** boundaries on Edge voices and per-**sentence**
  marks on every engine, each tagged with a CFI.
- **Paragraph mode** — a focus overlay that shows one block at a time.
- **Speed reader (RSVP)** — flashes one word at a time, paced by its own WPM timer.

Issue #3235 asks that paragraph mode and the speed reader **sync with TTS** so you can
listen and follow along in either view.

## Locked decisions

1. **TTS is the clock.** The two visual modes become *viewers* of the spoken position;
   they follow TTS, not the reverse.
2. **Both modes, one PR.** They share the same CFI-driven "follow TTS" plumbing.
3. **RSVP on non-Edge voices → sentence-paced fallback.** Word boundaries are Edge-only;
   on sentence-only engines RSVP jumps to the spoken sentence's first word and self-paces
   through its words, correcting at each sentence mark.
4. **Automatic coupling, but visible and escapable.** Whenever TTS and a mode are both
   active they sync by default — no separate "sync mode" setting. A visible "following
   audio" indicator shows when sync is active, and a manual scroll / paragraph-nav / RSVP
   skip **decouples** until the user re-engages. (Refined per CEO review — see audit trail.)
5. **RSVP gets a minimal TTS play/pause icon** in its existing control row (RSVP is a
   full-screen overlay that otherwise hides the TTS transport). This surfaces the existing
   TTS transport; it is not a new sync toggle.
6. **RSVP speed control is disabled while TTS-driven**, not repurposed to TTS rate.
   `handleSetRate` does a throttled (3000ms) stop→setRate→start cycle, so wiring a rapid
   +/- stepper to it would stutter/gap the audio. While externally driven, pace comes from
   the TTS voice (Edge word boundaries, or the non-Edge estimator); the WPM control is
   greyed out. (Refined per CEO review — see audit trail.)

## Architecture

### Glue: CFI

Every TTS position is already reported as a CFI, and both modes already map a CFI back to
their own index:

- `ParagraphIterator.findByRangeAsync(range)` → paragraph index (`src/utils/paragraph.ts`)
- `RSVPController.findWordIndexByCfi(cfi)` → word index (`src/services/rsvp/RSVPController.ts`)

So syncing is mostly: deliver the TTS CFI to each mode and call its existing seek.

### A. The bridge — `tts-position` broadcast

**The `TTSController` emits the canonical event; the hook forwards.** (Corrected per Eng
review — both voices flagged hook-owned broadcast as critical.) The controller already owns
the source of truth (`#ttsSectionIndex`, the active word/sentence range, `getCurrentHighlightCfi`,
`reapplyCurrentHighlight`). It emits `tts-position` from the same code paths that already fire
`tts-highlight-word` / `tts-highlight-mark` (`dispatchSpeakWord` / `dispatchSpeakMark`):

```ts
// on the controller (one source of truth):
{ cfi, kind: 'word' | 'sentence', sectionIndex, sequence }  // sequence = monotonic counter
```

`useTTSControl` adds `bookKey` and forwards it onto the shared `eventDispatcher` from a
**dedicated listener** (NOT inside `handleHighlightWord/Mark`, which early-return on
`followingTTSLocationRef` and active text selection — bolting the broadcast there would
silently desync the modes exactly when the reader suppresses page-follow). Forward gated only
by lifecycle, not page-follow state.

```ts
eventDispatcher.dispatch('tts-position', { bookKey, cfi, kind, sectionIndex, sequence });
```

**Latest-only / ordering.** `eventDispatcher.dispatch` awaits listeners serially and callers
fire-and-forget, so a slow word-42 map can land after word-43. Consumers keep
`lastSequenceSeen` and **ignore any event with a smaller `sequence`**; keep the hot path
synchronous (cursor lookup, no `await`/rAF inside the listener). Paragraph work coalesces to
sentence granularity.

**Lifecycle.** `ttsEnabled` is in `readerStore` (per `bookKey`) — modes read it. But
`isPlaying` is **hook-local** to `useTTSControl`, so add a `tts-playback-state` signal
(`{ bookKey, state: 'playing'|'paused'|'stopped' }`) the modes subscribe to for the
`following` ↔ paused transitions; do not assume RSVP can read `isPlaying`.

**Rejected alternatives:** putting the controller in a store/context (it is recreated each
TTS session → constant re-subscribe churn, and leaks the instance widely); polling
`getCurrentHighlightCfi()` (still needs controller access, plus a poll loop).

### B. Paragraph follows TTS — all engines

Sentence granularity is enough to choose a paragraph, so this works on every TTS engine.

In `useParagraphMode`, subscribe to `tts-position` (filtered by `bookKey`):

1. Resolve `cfi` → `Range` (`view.resolveCFI`).
2. If the CFI's section ≠ the iterator's section, the view has already been navigated by
   TTS; let the existing relocate handler re-init the iterator, then map on the next event.
3. `iterator.findByRangeAsync(range)` → `index`. If `index` ≠ current focus,
   `goToParagraph(index)` + `focusCurrentParagraph()`.
4. Guard with the existing `isFocusingRef` so the programmatic scroll doesn't re-enter.

**Start alignment.** When TTS is started while paragraph mode is active, dispatch
`tts-speak` with the focused paragraph's `range` and section `index` (the `tts-speak`
detail is `{ bookKey, range, index }`) so audio begins at the focused block (not the page
top). The focus flow already holds `currentRange`.

**Manual nav while synced.** When the user taps next/prev paragraph and TTS is playing,
**decouple** (stop following audio; the "following audio" indicator hides). TTS keeps
playing; the user is now browsing independently. Re-engaging the indicator re-syncs to the
current TTS position. (Decision 4 — decouple-on-manual-interaction, not reverse-driving.)

### C. Speed reader follows TTS

Add an **external-drive mode** to `RSVPController`: when engaged it suspends the internal
WPM `scheduleNextWord` timer and shows whatever word the driver points at.

New surface on `RSVPController`:

- `syncToCfi(cfi: string): void` — `findWordIndexByCfi` → `seekToIndex` (no timer arm).
- `setExternallyDriven(on: boolean): void` — suspend/resume the internal timer and flip a
  flag the overlay reads to adjust controls.

Wiring in `RSVPControl` (subscribes to `tts-position`, filtered by `bookKey`):

- **Edge (`kind: 'word'`):** `controller.syncToCfi(cfi)` — exact word-for-word read-along.
- **Non-Edge (`kind: 'sentence'`):** jump to the sentence's first word
  (`findWordIndexByCfi`), then advance its words on a local timer at an **estimated WPM
  derived from the TTS voice rate** (`ESTIMATED_TTS_WPM ≈ 190 × viewSettings.ttsRate`, a
  named tunable). The next sentence event snaps/corrects drift.

**Start alignment.** Starting TTS while RSVP is open dispatches `tts-speak` with the
current RSVP word's `range` and section `index`.

**Section transitions.** When TTS drives the view into the next section, RSVP re-extracts
words for the new section (reuse `loadNextPageContent`) on the relocate, then resumes
mapping CFIs. (Today RSVP-initiated section change goes through `rsvp-request-next-page`;
the TTS-driven path is the inverse — react to the view relocating.)

**Pace control while synced.** With the WPM timer suspended, the RSVP speed control is
**disabled / greyed out** while TTS-driven (decision 6) — do NOT repurpose it to TTS rate
(`handleSetRate`'s throttled stop→start would stutter the audio). Pace comes from the TTS
voice. To change speed while synced, the user adjusts the TTS rate from the TTS panel.

**Decouple on manual interaction.** A manual RSVP skip/seek (or paragraph next/prev) drops
the externally-driven state and returns the mode to its own controls; the "following audio"
indicator hides. Re-engaging (e.g. tapping the RSVP TTS icon, or the indicator) re-syncs to
the current TTS position.

### D. RSVP TTS trigger (decision 5)

Add one TTS play/pause icon to the RSVP overlay's control row. It dispatches the existing
`tts-speak` / `tts-stop` events (with the current RSVP word's range for start). State
(playing/idle) reflects `ttsEnabled`/`isPlaying`. Paragraph mode needs no new control —
its footer/TTS transport remains reachable.

## UI states & placement (from Design review — auto-adopted)

Both design voices flagged that the plan named widgets without designing them. Resolved
decisions below; build the indicator as one reusable component.

### Following-audio indicator — three states, not two

| State | When | Rendering |
|-------|------|-----------|
| `following` | TTS playing + mode following | Filled pill, voice/equalizer glyph + "Following audio". RSVP on non-Edge appends "· estimated" (sets expectation that pacing is approximate). |
| `decoupled` | TTS still playing, user took manual control | Ghost pill, sync glyph + "Resume audio" — **the pill IS the re-engage button**. Do NOT hide it (hiding reads as "sync broke"). |
| `syncing` | section re-init / CFI not yet mapped | `loading-dots` sub-state (reuse ParagraphBar's existing loading affordance). |
| `not-synced` | TTS off | Unmounted. |
| `unsupported` | fixed-layout if sync is gated off | No pill; one-line "Sync unavailable for this book" hint (don't fail silently). |

Component rules: `eink-bordered`, full-opacity text + glyph (never color-alone — RSVP is a
self-themed surface so global `[data-eink]` rules don't auto-apply; hand-apply, precedent =
RSVP "Look up" pill), logical start/end props (RTL), `touch-target`/`min-h-11` on mobile,
safe-area top inset via the overlay's `gridInsets`.

**Placement.** Paragraph mode → persistent top-center chip on `ParagraphOverlay` (NOT in the
auto-hiding `ParagraphBar`, which vanishes after 2s); relate it visually to the existing
"Back to TTS Location" affordance. RSVP → a slim status row **below the header, above the
context panel** — NOT inside the crowded transport row. Also resolve the paragraph-mode
bottom-bar stack: suppress `TTSBar` while paragraph mode is active (its transport duplicates
what the mode now follows).

### RSVP TTS toggle (decision 5)

Voice/headphones glyph (reuse `TTSIcon` / the TTS panel's voice metaphor) — **never a second
play triangle** (RSVP already has a 56px center play for word-flashing). `aria-label`
"Play audio" / "Pause audio" (distinct from RSVP's "Play"/"Pause"). Place at the control
cluster's trailing edge near the settings gear, divider-separated. Match RSVP's local idiom
(`gray-500/xx` ghost), not a daisyui `btn` (RSVP paints its own theme surface).

### Disabled WPM while synced (decision 6) + the rate escape hatch

Don't just dim it. Replace its content with a voice/lock glyph + "Audio pace"; use
`aria-disabled` (not a dead `disabled`); tooltip "Speed follows audio". Because the
full-screen RSVP overlay hides the TTS rate panel, **tapping it opens a compact TTS rate
picker** (reuse the existing rate options) so rate stays changeable without leaving RSVP —
a one-shot set, which is throttle-safe (unlike a rapid stepper). E-ink: signal disabled with
lock glyph + border, not opacity.

### Decouple UX (decision 4)

First decouple shows a one-time transient toast ("Stopped following audio — tap to resume").
Enumerate the gesture → decouple matrix so it's not invented ad-hoc:

| Gesture | Decouple? |
|---------|-----------|
| Paragraph next/prev/scroll/swipe | Yes |
| Paragraph neutral-zone tap (reveal controls) | No |
| RSVP skip / seek / word-step / progress-drag / chapter-jump / context-word-seek | Yes |
| RSVP center-tap (maps to TTS play/pause when synced) | No |
| RSVP speed-swipe | N/A (speed disabled while synced) |

Re-engage: tap the chip (or the RSVP TTS icon) → re-sync to the current TTS position.

Done-condition addition: toggle Settings → Misc → Eink and verify the indicator, RSVP TTS
icon, and disabled-WPM rendering.

## Data flow (Edge word-level, RSVP open)

```
audio.currentTime ─▶ EdgeTTSClient RAF ─▶ TTSController.dispatchSpeakWord(i)
   └▶ 'tts-highlight-word' {cfi}  (on controller)
        └▶ useTTSControl.handleHighlightWord
             └▶ eventDispatcher.dispatch('tts-position', {bookKey, cfi, kind:'word'})
                  ├▶ useParagraphMode  → findByRangeAsync → goToParagraph (if changed)
                  └▶ RSVPControl       → controller.syncToCfi(cfi) → seekToIndex
```

Non-Edge swaps the word RAF for sentence marks (`tts-position {kind:'sentence'}`); RSVP
self-paces between marks.

## Eng architecture corrections (from Eng review — auto-adopted)

Both eng voices converged 8/8. Adopted:

1. **Mapping must not be O(N)-from-0 per word.** `RSVPController.findWordIndexByCfi` and
   `ParagraphIterator.findByRangeAsync` currently rescan from index 0 each call. At Edge
   word rates on a 45k-word chapter this janks (and fixed-layout runs per-word `getCFI`,
   catastrophic). Fix: the new public mapper keeps a **monotonic cursor** (start scan at the
   last synced index, forward), with a **binary search** over the document-ordered ranges for
   seek/decouple/resync. Assert in tests that **no per-word `getCFI` runs**.
2. **Map by containment/overlap, not "first word whose start ≥ target."** The existing
   mapper returns the first word starting at-or-after the target, which **skips to the next
   word** when TTS lands mid-token. Choose the word whose range *contains/intersects* the
   target; only fall back to nearest-following when there's no overlap. (This is what the
   "tokenisation mismatch" risk actually needs — the old mapper did not solve it.)
3. **`syncToCfi` no-ops on no-match.** `findWordIndexByCfi` returns `-1` and
   `findByRangeAsync` falls back to `first()` — both silently jump to word/paragraph 0. The
   sync path must distinguish "no match" (do nothing, stay put) from a real index 0.
4. **Section-generation contract** (the highest-risk bug). When a `tts-position`'s
   `sectionIndex` ≠ the mode's current section: (a) do NOT map; (b) enter the `syncing`
   indicator state; (c) invalidate the mode's section state and let its own relocate-driven
   re-init run (`initIterator` / `loadNextPageContent`); (d) apply only the latest queued CFI
   once its section is ready and its `sequence` is still current. Paragraph's TTS-driven focus
   must use a **sync-focus path that does NOT arm `isFocusingRef`** — otherwise the 200ms
   `isFocusingRef` window eats the TTS relocate, the iterator never re-inits, and it focuses
   paragraph 0 of the wrong section.
5. **Gate sync to reflowable for v1.** Fixed-layout (`bookData.isFixedLayout`) → render the
   `unsupported` indicator state; don't run the per-word `getCFI` slow path.
6. **Non-Edge estimator guardrails** (D3 kept, so make it degrade well): seed `~190 × ttsRate`
   but **hold at the sentence's last word** until the next mark (never advance past the
   current sentence's word range), clamp per-word duration to a floor/ceiling, cap snap
   distance, and if a correction exceeds a threshold jump once rather than animate a long
   catch-up. Compute the sentence's end word index (next mark, or `getSpokenSentence().text`
   length) so "hold" has a bound.
7. **`bookKey` scoping:** filter on the full `bookKey` prop (TTS `bookKey` carries a session
   suffix that `RSVPController.bookId` strips — comparing `bookId` would misroute in split
   view). Validate a start-alignment range's `ownerDocument` matches the live content before
   dispatching `tts-speak`.

## Edge cases & risks

- **Tokenisation mismatch.** Edge word boundaries and RSVP's segmenter (Jieba / Intl) split
  differently. We map by **CFI/range containment**, not by index equality, so counts need
  not match; a TTS word that lands mid-RSVP-word resolves to that RSVP word.
- **Section boundary races.** TTS navigates the view; both modes re-init per section. Order
  matters — map only after the iterator/extraction targets the CFI's section.
- **User text selection / page-follow.** Existing TTS page-follow logic must keep working;
  the broadcast is additive and must not change current `tts-highlight-*` behavior.
- **Fixed-layout books.** RSVP's CFI path has a fixed-layout branch; verify mapping there or
  gate sync to reflowable.
- **Multiple views (split/parallel).** All events are `bookKey`-scoped; every subscriber
  filters on it.
- **No regressions when unsynced.** With TTS off, both modes behave exactly as today
  (timer-driven RSVP, manual paragraph nav).

## Testing (test-first)

Per `.claude/rules/test-first.md`, write failing tests first. Full matrix in the test-plan
artifact: `~/.gstack/projects/readest/tts-sync-test-plan-20260614.md`. Highlights:

- **Pure mappers (unit):** containment-based CFI→index for paragraph and RSVP (incl. mid-token
  / CJK / hyphen / rewritten-SSML); monotonic-cursor + binary-search correctness; **no-match
  returns -1** (not 0). Perf assertion: **no per-word `getCFI`** on Edge word events.
- **Controller emission (unit):** `TTSController` emits `tts-position` with correct
  `kind`/`sectionIndex`/monotonic `sequence` from `dispatchSpeakWord`/`dispatchSpeakMark`.
  Regression guard: "a handler stopped broadcasting" fails the test.
- **Stale-sequence suppression (unit):** out-of-order events ignored via `lastSequenceSeen`.
- **Non-Edge estimator (unit):** clamp + hold-at-sentence-end + cap-snap; outrun / early-end /
  slow+fast voice cases.
- **Decouple matrix (unit/integration):** the gesture→decouple table; re-engage re-syncs.
- **Section transition (browser-e2e, PRIMARY case):** TTS drives the view across a chapter
  boundary with paragraph + RSVP both active; assert correct re-init ordering (no wrong-section
  paragraph-0), `isFocusingRef` not eaten.
- **Multi-view `bookKey` isolation; fixed-layout `unsupported`** (integration).

**Prerequisite (flagged by Eng review; resolved at gate D6):** the real-`<foliate-view>` TTS
browser-e2e harness the e2e cases need (`src/__tests__/services/tts-auto-advance.browser.test.tsx`
+ memory note `tts-browser-e2e-harness.md`) **is not on `dev`/`main`** — it lives on the
`test/tts-auto-advance-e2e` branch. **Decision: branch #3235 off `test/tts-auto-advance-e2e`**
so the harness is present; rebase if that branch changes before it lands.

Done-conditions: `pnpm test`, `pnpm lint`. No `src-tauri/` or koplugin changes expected.

## Out of scope (v1)

- Word boundaries for Web Speech / Native engines.
- Reverse driving (RSVP WPM or paragraph nav continuously steering TTS) beyond the
  user-initiated re-seek.
- Persisting a "synced" preference (coupling is automatic and ephemeral).
- New i18n strings beyond the RSVP audio icon's label/tooltip + the "following audio" indicator.

<!-- AUTONOMOUS DECISION LOG (autoplan) -->
## Decision Audit Trail

CEO dual-voice review (Codex + independent Claude subagent) converged 6/6 on strategic
concerns. Premise gate surfaced four User Challenges; user resolved them as below.

| # | Phase | Decision | Class | Principle | Rationale | Rejected alt |
|---|-------|----------|-------|-----------|-----------|--------------|
| D1 | Intake | Review the #3235 spec doc, base origin/main, skip gstack housekeeping | Mechanical | P3 pragmatic | Only plan that exists; branch in flux; keep focus | branch-setup-first, gstack-upgrade-first |
| D2 | CEO | Keep both modes in **one PR** | User Challenge | user context | Both models recommended split; user kept one PR (shared plumbing, owns roadmap) | split paragraph-first |
| D3 | CEO | Keep the **non-Edge sentence-paced estimator** | User Challenge | user context | Both models called it gold-plating on `190×rate`; user kept it (wants word-motion on all voices) | snap-to-sentence-hold; Edge-only |
| D4 | CEO | Adopt indicator + decouple; **disable** RSVP speed while TTS-driven | User Challenge | P5 explicit | Both models flagged silent coupling surprise + speed→rate 3s-throttle stutter | keep silent coupling + speed→rate |
| A1 | CEO | Run Codex + Claude dual voices | Mechanical | P6 action | Always run both when available | — |
| A2 | CEO | Skip DX phase (Phase 3.5) | Mechanical | — | End-user reading feature, not developer-facing; no DX scope | run DX |
| A3 | Design | Adopt 3-state indicator + placement + voice-glyph + WPM rate-picker + decouple matrix + e-ink rules | Auto (P5/P1) | explicit/complete | Both design voices converged 8/8; additive specs, not reversals; folded into "UI states & placement" | leave UI to implementer |
| A4 | Eng | Controller-owned `tts-position` + sequence + latest-only + `tts-playback-state` | Auto (P5) | explicit | Both eng voices CRIT/HIGH; hook handlers early-return on suppression → silent desync | hook-owned dispatch |
| A5 | Eng | Monotonic-cursor + binary-search mapping; no per-word `getCFI`; containment match; -1 no-op | Auto (P1/P5) | complete | Both flagged O(N)/word jank + mid-token skip | keep first-≥ scan |
| A6 | Eng | Section-generation contract; sync-focus path that doesn't arm `isFocusingRef` | Auto (P5) | explicit | Highest shipped-bug risk (wrong-section paragraph 0) | "re-init on next event" hand-wave |
| A7 | Eng | Gate sync to reflowable v1 (fixed-layout → `unsupported`); estimator clamp/hold/snap-cap | Auto (P3/P1) | pragmatic | Per-word getCFI on fixed-layout catastrophic; estimator drift | full fixed-layout support now |
| A8 | Eng | Write test-plan artifact; flag e2e harness prerequisite (on `test/tts-auto-advance-e2e`, not dev) | Mechanical | complete | Cited harness absent on current checkout | assume harness exists |
| D5 | Gate | **Approve plan as-is** | User | — | All findings addressed or consciously deferred; plan implementation-ready | revise / interrogate |
| D6 | Gate | **Branch #3235 off `test/tts-auto-advance-e2e`** | User | — | e2e harness (section-boundary case) lives there, not on dev/main | land-to-main-first; defer-e2e |
| D7 | Gate | **Gate sync to reflowable for v1** (fixed-layout → unsupported) | User (confirms A7) | P3/P1 | per-word `getCFI` on fixed-layout janks | support fixed-layout now |

## GSTACK REVIEW REPORT

**Status: APPROVED** (gate D5). /autoplan pipeline: CEO → Design → Eng (DX skipped — no
developer-facing scope). Dual voices (Codex `codex-cli 0.134.0` + independent Claude
subagent) each phase. Consensus: CEO 6/6, Design 8/8, Eng 8/8. 3 User Challenges (you kept
one-PR + estimator, adopted coupling refinements); 8 auto-decisions; 3 gate decisions.
Artifacts: this spec (hardened), test plan `~/.gstack/projects/readest/tts-sync-test-plan-20260614.md`,
restore point `~/.gstack/projects/readest/autoplan-restore-tts-sync-20260614-024952.md`.
Next: branch #3235 off `test/tts-auto-advance-e2e`, then writing-plans → implement (test-first).

### CEO findings carried forward (not blocking, for Eng/Design phases)
- **Estimator fidelity (D3 kept):** Eng must pin `ESTIMATED_TTS_WPM` behavior so non-Edge
  RSVP degrades gracefully (race-then-snap is the risk). Consider clamping per-word
  duration and capping snap distance.
- **Position-broadcast ownership (6-month regret):** prefer the controller emitting the
  canonical `tts-position` with the hook forwarding, over hand-mirroring in React handlers,
  so a future engine can't silently desync. Add a regression test for "handler stopped
  broadcasting."
- **Section-race timing:** new sync path stacks onto existing tuned timers (2000ms TTS
  cross-section suppression, 200/100ms paragraph relocate guards, RSVP 150/200ms retries).
  Make sync subscribe to the same relocate/highlight signals; write down the ordering
  contract; test the section boundary as a primary case.

