# Hotkey to Highlight the Currently-Spoken TTS Sentence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyboard action (default `Shift+M`, "Text to Speech" section) that persists the sentence TTS is currently reading aloud as a normal highlight using the user's default style/color — eyes-off, silent, idempotent (skip duplicates).

**Architecture:** Connect the two existing owners through the app event bus. `TTSController` is the only place that knows both `view.tts` (current sentence Range) and the TTS section index, so it exposes `getSpokenSentence(): { cfi, text } | null`. `Annotator` owns highlight persistence/rendering, so it creates the note. The shortcut → `useBookShortcuts` dispatches `tts-highlight-sentence` → `useTTSControl` (holds the controller ref) resolves the sentence and dispatches `create-tts-highlight` → `Annotator` builds/persists/draws the highlight. The bug-prone create-or-skip decision is a pure, unit-tested helper.

**Tech Stack:** TypeScript, React, Zustand, foliate-js, Vitest. Spec: `docs/superpowers/specs/2026-05-30-tts-highlight-current-sentence-design.md`.

**Conventions:**
- Test-first (project rule `.agents/rules/test-first.md`): write the failing test, run it red, implement, run it green.
- Never use the `any` type (`.agents/rules/typescript.md`); the test code below casts mock objects via `as unknown as <Type>`, matching the existing suites.
- Run a single test file with `pnpm test <path>` (no `--`).
- Conventional commits with scope, e.g. `feat(tts): ...`. End every commit message body with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Do not push during implementation; commit locally only.

---

## File Structure

| File | Change | Responsibility |
| ---- | ------ | -------------- |
| `src/app/reader/utils/annotatorUtil.ts` | Modify | Add pure `buildTTSSentenceHighlight()` (create-or-skip decision + BookNote assembly) |
| `src/__tests__/utils/annotator-util.test.ts` | Modify | Unit tests for `buildTTSSentenceHighlight` |
| `src/services/tts/TTSController.ts` | Modify | Add `getSpokenSentence()` resolver |
| `src/__tests__/services/tts-controller.test.ts` | Modify | Unit tests for `getSpokenSentence` |
| `src/helpers/shortcuts.ts` | Modify | Register `onTTSHighlightSentence` default binding |
| `src/app/reader/hooks/useBookShortcuts.ts` | Modify | Handler that dispatches `tts-highlight-sentence` |
| `src/app/reader/hooks/useTTSControl.ts` | Modify | Resolve sentence via controller, relay `create-tts-highlight` |
| `src/app/reader/components/annotator/Annotator.tsx` | Modify | Handle `create-tts-highlight`: build/persist/draw |

---

## Task 1: Pure helper `buildTTSSentenceHighlight`

**Files:**
- Modify: `src/app/reader/utils/annotatorUtil.ts`
- Test: `src/__tests__/utils/annotator-util.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/utils/annotator-util.test.ts`. Also add `buildTTSSentenceHighlight` to the existing import from `@/app/reader/utils/annotatorUtil` and `HighlightStyle`, `HighlightColor` to the existing `@/types/book` import:

```ts
describe('buildTTSSentenceHighlight', () => {
  const params = {
    cfi: 'epubcfi(/6/4!/4/10,/1:0,/1:42)',
    text: 'A spoken sentence.',
    style: 'highlight' as HighlightStyle,
    color: 'yellow' as HighlightColor,
    page: 7,
  };

  it('builds an annotation BookNote when none exists at the cfi', () => {
    const note = buildTTSSentenceHighlight([], params, 1000);
    expect(note).not.toBeNull();
    expect(note).toMatchObject({
      type: 'annotation',
      cfi: params.cfi,
      text: params.text,
      style: 'highlight',
      color: 'yellow',
      page: 7,
      note: '',
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(typeof note!.id).toBe('string');
    expect(note!.id.length).toBeGreaterThan(0);
  });

  it('returns null (skip) when a live annotation already exists at the cfi', () => {
    const existing: BookNote = {
      id: 'a1',
      type: 'annotation',
      cfi: params.cfi,
      style: 'highlight',
      color: 'red',
      text: params.text,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(buildTTSSentenceHighlight([existing], params, 1000)).toBeNull();
  });

  it('builds when the only note at the cfi is soft-deleted', () => {
    const deleted: BookNote = {
      id: 'a1',
      type: 'annotation',
      cfi: params.cfi,
      style: 'highlight',
      color: 'red',
      text: params.text,
      note: '',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: 5,
    };
    expect(buildTTSSentenceHighlight([deleted], params, 1000)).not.toBeNull();
  });

  it('builds when the note at the cfi is a non-annotation (bookmark)', () => {
    const bookmark: BookNote = {
      id: 'b1',
      type: 'bookmark',
      cfi: params.cfi,
      note: '',
      createdAt: 1,
      updatedAt: 1,
    };
    expect(buildTTSSentenceHighlight([bookmark], params, 1000)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/__tests__/utils/annotator-util.test.ts`
Expected: FAIL — `buildTTSSentenceHighlight is not a function` / import error.

- [ ] **Step 3: Implement the helper**

In `src/app/reader/utils/annotatorUtil.ts`, extend the top imports and add the function. Change the `@/types/book` import line to include `HighlightStyle`, and add `uniqueId`:

```ts
import { BookNote, DEFAULT_HIGHLIGHT_COLORS, HighlightColor, HighlightStyle } from '@/types/book';
import { uniqueId } from '@/utils/misc';
```

Add at the end of the file:

```ts
/**
 * Build a persistent highlight BookNote for a TTS-spoken sentence, or return
 * `null` when one already exists at the same CFI (idempotent — pressing the
 * hotkey twice on the same sentence must not create a duplicate).
 *
 * `now` is injected so the result is deterministic for tests. A soft-deleted
 * note (`deletedAt`) or a non-annotation note (e.g. a bookmark) at the same CFI
 * does not block creation — it mirrors the live-annotation predicate used by
 * the selection-based highlight path in Annotator.tsx.
 */
export function buildTTSSentenceHighlight(
  annotations: BookNote[],
  params: {
    cfi: string;
    text: string;
    style: HighlightStyle;
    color: HighlightColor;
    page?: number;
  },
  now: number,
): BookNote | null {
  const exists = annotations.some(
    (a) => a.cfi === params.cfi && a.type === 'annotation' && a.style && !a.deletedAt,
  );
  if (exists) return null;
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/__tests__/utils/annotator-util.test.ts`
Expected: PASS (all `buildTTSSentenceHighlight` cases green, existing cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/app/reader/utils/annotatorUtil.ts src/__tests__/utils/annotator-util.test.ts
git commit -m "$(cat <<'EOF'
feat(tts): add buildTTSSentenceHighlight helper for sentence highlights

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `TTSController.getSpokenSentence()`

**Files:**
- Modify: `src/services/tts/TTSController.ts` (add method near `dispatchSpeakMark`, ~line 565)
- Test: `src/__tests__/services/tts-controller.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block inside the top-level `describe('TTSController', ...)` in `src/__tests__/services/tts-controller.test.ts` (e.g. after the `dispatchSpeakMark` block). It reuses the file's existing `controller`, `mockView`, and `createMockView` setup:

```ts
describe('getSpokenSentence', () => {
  test('returns the trimmed text and cfi of the current sentence', async () => {
    await controller.initViewTTS(0);
    mockView.tts = {
      getLastRange: vi.fn().mockReturnValue({ toString: () => '  A spoken sentence.  ' }),
    } as unknown as FoliateView['tts'];
    vi.mocked(mockView.getCFI).mockReturnValue('cfi-current');

    expect(controller.getSpokenSentence()).toEqual({
      cfi: 'cfi-current',
      text: 'A spoken sentence.',
    });
  });

  test('returns null when TTS is inactive (no view.tts)', () => {
    // No initViewTTS: view.tts is null and the section index is -1.
    expect(controller.getSpokenSentence()).toBeNull();
  });

  test('returns null when there is no current range', async () => {
    await controller.initViewTTS(0);
    mockView.tts = {
      getLastRange: vi.fn().mockReturnValue(undefined),
    } as unknown as FoliateView['tts'];

    expect(controller.getSpokenSentence()).toBeNull();
  });

  test('returns null when getCFI throws', async () => {
    await controller.initViewTTS(0);
    mockView.tts = {
      getLastRange: vi.fn().mockReturnValue({ toString: () => 'x' }),
    } as unknown as FoliateView['tts'];
    vi.mocked(mockView.getCFI).mockImplementation(() => {
      throw new Error('cfi failure');
    });

    expect(controller.getSpokenSentence()).toBeNull();
  });

  test('returns null when the sentence text is only whitespace', async () => {
    await controller.initViewTTS(0);
    mockView.tts = {
      getLastRange: vi.fn().mockReturnValue({ toString: () => '   ' }),
    } as unknown as FoliateView['tts'];
    vi.mocked(mockView.getCFI).mockReturnValue('cfi-current');

    expect(controller.getSpokenSentence()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/__tests__/services/tts-controller.test.ts`
Expected: FAIL — `controller.getSpokenSentence is not a function`.

- [ ] **Step 3: Implement the method**

In `src/services/tts/TTSController.ts`, add this public method immediately above `dispatchSpeakMark(mark?: TTSMark)` (~line 565). It performs the same Range→CFI conversion `dispatchSpeakMark` already uses, reading the current sentence Range from the foliate TTS engine and the active TTS section index:

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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/__tests__/services/tts-controller.test.ts`
Expected: PASS (new cases green, existing cases still green).

- [ ] **Step 5: Commit**

```bash
git add src/services/tts/TTSController.ts src/__tests__/services/tts-controller.test.ts
git commit -m "$(cat <<'EOF'
feat(tts): expose getSpokenSentence on TTSController

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Register the default shortcut binding

**Files:**
- Modify: `src/helpers/shortcuts.ts` (TTS section, after `onTTSGoPreviousParagraph`, ~line 75)

There is no standalone unit test for the static registry; correctness is verified by `pnpm lint` (tsgo derives `ShortcutConfig` from this object) and by the wiring tasks. The new action automatically appears in the keyboard-shortcuts help dialog because its `section` is non-empty.

- [ ] **Step 1: Add the entry**

In `src/helpers/shortcuts.ts`, insert into `DEFAULT_SHORTCUTS` immediately after the `onTTSGoPreviousParagraph` block (line 75):

```ts
  onTTSHighlightSentence: {
    keys: ['shift+m'],
    description: _('Highlight Current Sentence'),
    section: 'Text to Speech',
  },
```

- [ ] **Step 2: Type-check**

Run: `pnpm lint`
Expected: PASS. `ShortcutConfig` now includes `onTTSHighlightSentence`. (If `useBookShortcuts` is type-checked before Task 4 wires the handler, `useShortcuts` accepts a partial map, so this should not error on its own; if it does, proceed to Task 4 and re-run.)

- [ ] **Step 3: Commit**

```bash
git add src/helpers/shortcuts.ts
git commit -m "$(cat <<'EOF'
feat(tts): add default Shift+M binding for highlight-current-sentence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Dispatch the shortcut event from `useBookShortcuts`

**Files:**
- Modify: `src/app/reader/hooks/useBookShortcuts.ts` (handler ~after line 301; registration ~line 358)

- [ ] **Step 1: Add the handler**

In `src/app/reader/hooks/useBookShortcuts.ts`, add immediately after `ttsGoPreviousParagraph` (line 301), mirroring `ttsGoNextSentence`:

```ts
  const ttsHighlightSentence = () => {
    if (!sideBarBookKey) return;
    eventDispatcher.dispatch('tts-highlight-sentence', { bookKey: sideBarBookKey });
  };
```

- [ ] **Step 2: Register the handler**

In the `useShortcuts({ ... })` map, add after the `onTTSGoPreviousParagraph: ttsGoPreviousParagraph,` line (line 358):

```ts
      onTTSHighlightSentence: ttsHighlightSentence,
```

- [ ] **Step 3: Type-check**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/reader/hooks/useBookShortcuts.ts
git commit -m "$(cat <<'EOF'
feat(tts): dispatch tts-highlight-sentence from the shortcut handler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Resolve the sentence and relay it from `useTTSControl`

**Files:**
- Modify: `src/app/reader/hooks/useTTSControl.ts` (handler ~after line 81; effect registration lines 103-114)

- [ ] **Step 1: Add the handler**

In `src/app/reader/hooks/useTTSControl.ts`, add after `handleTTSBackward` (line 81), mirroring the bookKey-matched pattern of the existing TTS handlers:

```ts
  const handleTTSHighlightSentence = (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string } | undefined;
    if (detail?.bookKey !== bookKey) return;
    const sentence = ttsControllerRef.current?.getSpokenSentence();
    if (!sentence) return;
    eventDispatcher.dispatch('create-tts-highlight', { bookKey, ...sentence });
  };
```

- [ ] **Step 2: Register/unregister in the existing effect**

In the `useEffect` at lines 103-119, add the `on`/`off` pair alongside the other TTS listeners:

```ts
    eventDispatcher.on('tts-speak', handleTTSSpeak);
    eventDispatcher.on('tts-stop', handleTTSStop);
    eventDispatcher.on('tts-forward', handleTTSForward);
    eventDispatcher.on('tts-backward', handleTTSBackward);
    eventDispatcher.on('tts-toggle-play', handleTTSTogglePlay);
    eventDispatcher.on('tts-highlight-sentence', handleTTSHighlightSentence);
    return () => {
      eventDispatcher.off('tts-speak', handleTTSSpeak);
      eventDispatcher.off('tts-stop', handleTTSStop);
      eventDispatcher.off('tts-forward', handleTTSForward);
      eventDispatcher.off('tts-backward', handleTTSBackward);
      eventDispatcher.off('tts-toggle-play', handleTTSTogglePlay);
      eventDispatcher.off('tts-highlight-sentence', handleTTSHighlightSentence);
```

(Leave the existing `ttsControllerRef.current?.shutdown()` cleanup below unchanged.)

- [ ] **Step 3: Type-check**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/reader/hooks/useTTSControl.ts
git commit -m "$(cat <<'EOF'
feat(tts): resolve spoken sentence and relay create-tts-highlight

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Create the highlight in `Annotator`

**Files:**
- Modify: `src/app/reader/components/annotator/Annotator.tsx` (import line 50; handler near `handleHighlight` ~line 840; effect lines 535-545)

- [ ] **Step 1: Import the helper**

Change line 50 to add `buildTTSSentenceHighlight`:

```ts
import {
  buildTTSSentenceHighlight,
  getHighlightColorHex,
  removeBookNoteOverlays,
} from '../../utils/annotatorUtil';
```

- [ ] **Step 2: Add the event handler**

Add immediately after `handleHighlight` (after its closing brace, ~line 840). It reads state freshly via store getters (the listener is registered with `[]` deps, so it must not close over render-time `config`/`settings`/`progress`), matching the fresh-read pattern in `onShowAnnotation`:

```ts
  const handleCreateTTSHighlight = (event: CustomEvent) => {
    const detail = event.detail as { bookKey: string; cfi: string; text: string } | undefined;
    if (!detail || detail.bookKey !== bookKey) return;
    const { settings } = useSettingsStore.getState();
    const style = settings.globalReadSettings.highlightStyle;
    const color = settings.globalReadSettings.highlightStyles[style];
    const { booknotes: annotations = [] } = getConfig(bookKey)!;
    const page = getProgress(bookKey)?.page;
    const annotation = buildTTSSentenceHighlight(
      annotations,
      { cfi: detail.cfi, text: detail.text, style, color, page },
      Date.now(),
    );
    if (!annotation) return;
    annotations.push(annotation);
    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
    const views = getViewsById(bookKey.split('-')[0]!);
    views.forEach((view) => view?.addAnnotation(annotation));
  };
```

- [ ] **Step 3: Register/unregister in the existing mount effect**

In the `useEffect` at lines 535-545, add the `on`/`off` pair:

```ts
    eventDispatcher.on('export-annotations', handleExportMarkdown);
    eventDispatcher.on('clear-annotations', handleClearAnnotations);
    eventDispatcher.on('import-annotations', handleImportAnnotations);
    eventDispatcher.on('create-tts-highlight', handleCreateTTSHighlight);
    return () => {
      eventDispatcher.off('export-annotations', handleExportMarkdown);
      eventDispatcher.off('clear-annotations', handleClearAnnotations);
      eventDispatcher.off('import-annotations', handleImportAnnotations);
      eventDispatcher.off('create-tts-highlight', handleCreateTTSHighlight);
    };
```

- [ ] **Step 4: Type-check**

Run: `pnpm lint`
Expected: PASS. (`useSettingsStore` is already imported at line 13; `getConfig`, `getProgress`, `getViewsById`, `updateBooknotes`, `saveConfig`, `envConfig` are all already in scope per lines 80-85.)

- [ ] **Step 5: Commit**

```bash
git add src/app/reader/components/annotator/Annotator.tsx
git commit -m "$(cat <<'EOF'
feat(tts): persist current TTS sentence as a highlight on create-tts-highlight

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS (no regressions; the two new test blocks green).

- [ ] **Step 2: Lint + type-check**

Run: `pnpm lint`
Expected: PASS (Biome + tsgo clean).

- [ ] **Step 3: Manual smoke test (dev web)**

Run: `pnpm dev-web`, open a book, start TTS (`t`), let it read a sentence, then press `Shift+M`. Confirm:
  - the spoken sentence gets a persistent highlight in the user's default color/style;
  - pressing the hotkey again on the same sentence does **not** add a second highlight;
  - pressing it while TTS is stopped does nothing (no error in console);
  - the highlight survives reopening the book (persisted), and appears in the notebook/annotations list.
  - the action shows up in the keyboard-shortcuts help dialog (`Shift+?`) under "Text to Speech".

- [ ] **Step 4: (Optional) i18n extraction**

The new `_('Highlight Current Sentence')` string uses key-as-content, so tests/lint pass without extraction. If desired, run the project i18n extraction (`/i18n` skill or `pnpm i18n`) to sync locale catalogs; this is not required for verification to pass and may touch unrelated locale files — keep it out of the feature commits if run.

---

## Notes for the implementer

- **No production test seams.** `getSpokenSentence` is tested by setting the private `#ttsSectionIndex` through the public `controller.initViewTTS(0)` path, then overriding `mockView.tts`/`mockView.getCFI` — exactly how the existing `forward`/`backward`/`start` tests in that suite operate.
- **Granularity is always sentence.** All TTS clients report only `'sentence'` from `getGranularities()`, so `view.tts.getLastRange()` is always a sentence Range — no word-vs-sentence branching is needed.
- **Two events, three components, by design.** Only `TTSController` (via `useTTSControl`) can produce the CFI; only `Annotator` owns highlight persistence. The relay mirrors the existing `tts-forward`/`tts-backward` shortcut pattern rather than duplicating annotation logic.
- **bookKey matching everywhere.** Both new handlers compare `detail.bookKey === bookKey`, so split-view (two open books) routes the highlight to the correct book.
```
