# Hotkey to Highlight the Currently-Spoken TTS Sentence — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)
**Issue:** [#4085](https://github.com/readest/readest/issues/4085)

## Problem

While TTS is reading aloud, there is no way to persist the sentence currently
being spoken as a highlight without stopping playback, locating the text
visually, and dragging to select it. That defeats the purpose of hands-free /
eyes-off TTS reading and is inaccessible to users with motor or visual
impairments — exactly the audience that benefits most from "react with a single
key" capture.

Today the only workarounds are to stop TTS and select manually, or to take notes
outside Readest (which then aren't synced/exported with the book).

## Goal

Add a single configurable keyboard action that, while TTS is active, persists the
**sentence currently being read aloud** as a normal highlight — same data model,
persistence, rendering, sync, and export as any other highlight — using the
user's current default highlight style/color. No selection, no looking at the
screen.

## Decisions (locked)

- **Default keybinding:** `Shift+M` ("M for mark"), in the existing
  **"Text to Speech"** shortcut section. A single, easy-to-hit key best fits the
  eyes-off accessibility motivation. Chosen over the issue's suggested `Ctrl+H`
  (already bound to *Highlight Selection*), over `Ctrl/Cmd+Shift+H` (the `cmd+`
  variant collides with browser/OS `Cmd+Shift+H` on macOS, and the matcher fires
  on any listed key regardless of platform), over `Shift+H` (already an alias for
  *Go Back*), and over "unbound by default" (the #3772 customization UI does not
  exist yet, so an unbound default would be unreachable by normal users). `Shift+M`
  is currently unused, has no browser/OS collision, and behaves identically on all
  platforms; it remains customizable once #3772 ships.
- **Repeat press = skip:** If the current sentence is already highlighted, do
  nothing. No duplicate, no toggle-delete (an accidental eyes-off repeat must
  never destroy a highlight), no color cycling.
- **Silent:** No toast/confirmation. The highlight simply appears.
- **Style/color:** The user's current default —
  `settings.globalReadSettings.highlightStyle` and
  `highlightStyles[style]` — identical to a default selection highlight.
- **Granularity:** The spoken unit is always a **sentence**. All three TTS
  clients (`WebSpeechClient`, `EdgeTTSClient`, `NativeTTSClient`) report only
  `'sentence'` granularity via `getGranularities()`, so `view.tts.getLastRange()`
  always returns the current sentence Range (never a word).

## Why this wiring

Two existing owners must cooperate, and the design connects them rather than
duplicating their responsibilities:

- Only `TTSController` knows **both** `view.tts` (the foliate TTS engine — source
  of the current sentence Range) **and** `#ttsSectionIndex` (required to convert
  that Range into a CFI). It already performs exactly this conversion in
  `dispatchSpeakMark` (`this.view.getCFI(this.#ttsSectionIndex, range)`).
- Only `Annotator` owns highlight creation — the `BookNote` data model,
  idempotency, persistence (`updateBooknotes` + `saveConfig`), rendering
  (`view.addAnnotation`), and global-annotation fan-out.

They are connected through the app event bus (`eventDispatcher`), mirroring the
existing `tts-forward` / `tts-backward` / `tts-toggle-play` shortcuts that
`useBookShortcuts` dispatches and `useTTSControl` handles against the controller
ref.

## Data flow

```
User presses Shift+M
  → useBookShortcuts: onTTSHighlightSentence handler
       eventDispatcher.dispatch('tts-highlight-sentence', { bookKey })
  → useTTSControl: 'tts-highlight-sentence' handler (owns the TTSController ref)
       const sentence = ttsController.getSpokenSentence();   // { cfi, text } | null
       if (sentence) eventDispatcher.dispatch('create-tts-highlight',
                                              { bookKey, ...sentence });
  → Annotator: 'create-tts-highlight' handler
       build a BookNote (type 'annotation', default style/color, cfi, text);
       skip if a non-deleted annotation already exists at that cfi;
       else updateBooknotes + saveConfig + view.addAnnotation(annotation).
```

## Architecture

### 1. Shortcut definition — `src/helpers/shortcuts.ts`

Add to `DEFAULT_SHORTCUTS`:

```ts
onTTSHighlightSentence: {
  keys: ['shift+m'],
  description: _('Highlight Current Sentence'),
  section: 'Text to Speech',
},
```

`ShortcutConfig` is derived from `DEFAULT_SHORTCUTS`, so the type updates
automatically and the action appears in the shortcuts help dialog with no extra
work. When the #3772 customization UI lands, this action is customizable like any
other.

### 2. Current-sentence resolver — `src/services/tts/TTSController.ts`

New public method, the single source of truth for "what sentence is being
spoken right now":

```ts
getSpokenSentence(): { cfi: string; text: string } | null {
  const range = this.view.tts?.getLastRange();
  if (!range || this.#ttsSectionIndex < 0) return null;
  try {
    const cfi = this.view.getCFI(this.#ttsSectionIndex, range);
    const text = range.toString().trim();
    if (!cfi || !text) return null;
    return { cfi, text };
  } catch {
    return null;
  }
}
```

Returns `null` when TTS is inactive (`view.tts` is cleared on `shutdown`) or no
sentence is current — the natural no-op gate. Works whether TTS is playing or
paused (a paused controller keeps `view.tts` and the last mark).

### 3. Shortcut handler — `src/app/reader/hooks/useBookShortcuts.ts`

New handler mirroring `ttsGoNextSentence`, registered as `onTTSHighlightSentence`:

```ts
const ttsHighlightSentence = () => {
  if (!sideBarBookKey) return;
  eventDispatcher.dispatch('tts-highlight-sentence', { bookKey: sideBarBookKey });
};
```

### 4. Resolver glue — `src/app/reader/hooks/useTTSControl.ts`

New handler for `'tts-highlight-sentence'`, registered/cleaned up alongside the
existing TTS event listeners (`tts-forward`, `tts-backward`, …):

```ts
const handleTTSHighlightSentence = (event: CustomEvent) => {
  const detail = event.detail as { bookKey: string } | undefined;
  if (detail?.bookKey !== bookKey) return;
  const sentence = ttsControllerRef.current?.getSpokenSentence();
  if (!sentence) return;
  eventDispatcher.dispatch('create-tts-highlight', { bookKey, ...sentence });
};
```

### 5. Highlight creation — pure helper + Annotator event handler

The selection path (`handleHighlight`) is selection-coupled and does more than
the TTS path needs (it reads `selection`, computes the CFI from
`selection.range`, updates an existing note, carries the `global` flag, and
drives popup/selection UI state). The TTS path is strictly simpler — create or
skip — so rather than overloading `handleHighlight`, the bug-prone *decision* is
extracted as a pure, unit-testable helper and the Annotator keeps the
React/persistence glue.

**Pure helper — `src/app/reader/utils/annotatorUtil.ts`:**

```ts
export function buildTTSSentenceHighlight(
  annotations: BookNote[],
  params: { cfi: string; text: string; style: HighlightStyle; color: HighlightColor; page?: number },
  now: number,
): BookNote | null {
  const exists = annotations.some(
    (a) => a.cfi === params.cfi && a.type === 'annotation' && a.style && !a.deletedAt,
  );
  if (exists) return null; // idempotent: skip duplicates (locked decision)
  return {
    id: uniqueId(),
    type: 'annotation',
    note: '',
    createdAt: now,
    updatedAt: now,
    ...params,
  };
}
```

This mirrors the idempotency predicate already used inline in `handleHighlight`
(`annotations.findIndex(a => a.cfi === cfi && a.type === 'annotation' && a.style
&& !a.deletedAt)`). `now` is injected so the helper is deterministic for tests.

**Annotator — `src/app/reader/components/annotator/Annotator.tsx`:**

A new `'create-tts-highlight'` event handler (bookKey-matched), subscribed
alongside the other `eventDispatcher` listeners: read default `style`/`color`
from `settings.globalReadSettings`, call `buildTTSSentenceHighlight`; if it
returns `null`, do nothing; otherwise push the note, `updateBooknotes` +
`saveConfig`, and `view.addAnnotation(annotation)` for each view — the same
persistence/render calls the selection path makes.

## Edge cases

| Condition | Behavior |
| --------- | -------- |
| TTS not playing / no current sentence | `getSpokenSentence()` → `null` → silent no-op |
| Sentence already highlighted | idempotency skip — no duplicate (locked decision) |
| TTS reading a not-yet-visible section | CFI uses the TTS section index; note is saved and draws when that section renders (existing `onCreateOverlay` path) |
| Live gray TTS cursor overlay overlaps the new highlight | distinct overlay keys; the gray cursor moves on as TTS advances, leaving the persistent highlight |
| Wrong book (split view) | every handler is bookKey-matched, as the existing TTS handlers are |

## Testing

Test-first, per project rule. Both new units are testable with **no production
test seams**:

- **`TTSController.getSpokenSentence()`** — add to
  `src/__tests__/services/tts-controller.test.ts`. The private
  `#ttsSectionIndex` is set through the public `await controller.initViewTTS(0)`
  path (already exercised in that suite); `mockView.tts.getLastRange` and
  `mockView.getCFI` are stubbed via the existing `createMockView` helper.
  Cases: returns `{ cfi, text }` (trimmed) when a sentence is active; returns
  `null` when `view.tts` is absent (pre-init), when `getLastRange()` is
  undefined, when `getCFI` throws, and when the range text is empty/whitespace.
- **`buildTTSSentenceHighlight`** — add to
  `src/__tests__/utils/annotator-util.test.ts`. Cases: builds a `BookNote`
  (`type: 'annotation'`, given `cfi`/`text`/`style`/`color`/`page`, injected
  timestamps) when none exists; returns `null` when a non-deleted annotation
  already exists at that `cfi`; still builds when the only match at that `cfi`
  is `deletedAt`-soft-deleted or a non-annotation (`bookmark`).

Then verify with `pnpm test` and `pnpm lint`.

## Non-goals / YAGNI

- No toast/confirmation, no haptics (locked: silent).
- No toggle-to-remove and no color cycling on repeat (locked: skip).
- No shortcut-customization UI — that is #3772; this only adds one entry to the
  existing registry, which #3772 will expose.
- No word-level highlighting (#4017) — out of scope; granularity is always
  sentence in practice.
- No new user-facing settings.
- No change to selection-based highlighting behavior.
