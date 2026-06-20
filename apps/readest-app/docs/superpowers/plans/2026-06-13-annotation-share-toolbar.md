# Annotation Share Tool + Customizable Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native "Share" tool to the text-selection toolbar (#4014) and let users show/hide and reorder annotation tools via a drag-and-drop sub-page in Settings → Behavior.

**Architecture:** Pure helpers in `src/utils/annotationToolbar.ts` own the visible/available split + reorder logic (unit-tested); `src/utils/share.ts` owns the sharekit → `navigator.share` → clipboard ladder (unit-tested). `Annotator.tsx` filters/orders its toolbar buttons through `getToolbarToolTypes` and adds `handleShare`. A new `AnnotationToolbarCustomizer` sub-page (reached from `ControlPanel`) renders the real tool buttons in two `@dnd-kit` zones. The visible order is persisted as a new view setting `annotationToolbarItems`.

**Tech Stack:** Next.js + React + TypeScript, Zustand view settings, `@dnd-kit/core` + `/sortable`, `@choochmeque/tauri-plugin-sharekit-api`, Vitest + jsdom, Biome + tsgo.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/types/annotator.ts` | `AnnotationToolType` union | Modify — add `'share'` |
| `src/types/book.ts` | `AnnotatorConfig` | Modify — add `annotationToolbarItems` |
| `src/utils/annotationToolbar.ts` | Pure toolbar order/visibility helpers + default list | Create |
| `src/utils/share.ts` | Share-text ladder helper | Create |
| `src/services/constants.ts` | `DEFAULT_ANNOTATOR_CONFIG` | Modify — add default items |
| `src/app/reader/components/annotator/AnnotationTools.tsx` | Tool button registry | Modify — add `share` |
| `src/app/reader/components/annotator/Annotator.tsx` | Live toolbar + handlers | Modify — `handleShare`, `canShare`, filtered `toolButtons`, quick-action |
| `src/components/settings/AnnotationToolbarCustomizer.tsx` | DnD customizer sub-page | Create |
| `src/components/settings/ControlPanel.tsx` | Behavior panel | Modify — `NavigationRow` + sub-page + reset |
| `src/__tests__/utils/annotationToolbar.test.ts` | Helper tests | Create |
| `src/__tests__/utils/share.test.ts` | Share-ladder tests | Create |
| `src/__tests__/services/constants.test.ts` | Defaults assertion | Modify |

All commands run from `apps/readest-app` in the worktree `/Users/chrox/dev/readest-feat-annotation-share-toolbar-4014`.

---

## Task 1: Add the `share` tool type and button

**Files:**
- Modify: `src/types/annotator.ts`
- Modify: `src/app/reader/components/annotator/AnnotationTools.tsx`

- [ ] **Step 1: Add `'share'` to the union**

In `src/types/annotator.ts`, change the union to:

```typescript
export type AnnotationToolType =
  | 'copy'
  | 'highlight'
  | 'annotate'
  | 'search'
  | 'dictionary'
  | 'translate'
  | 'tts'
  | 'proofread'
  | 'share';
```

- [ ] **Step 2: Add the share icon import**

In `src/app/reader/components/annotator/AnnotationTools.tsx`, add to the existing `react-icons/fi` imports block (it already imports `FiSearch`, `FiCopy`):

```typescript
import { FiShare } from 'react-icons/fi';
```

- [ ] **Step 3: Add the `share` button entry**

In the same file, append a new entry to the `createAnnotationToolButtons([...])` array, after the `proofread` entry (keep it last so the canonical order matches `ALL_ANNOTATION_TOOL_TYPES` in Task 2):

```typescript
  {
    type: 'share',
    label: _('Share'),
    tooltip: _('Share text after selection'),
    Icon: FiShare,
    quickAction: true,
  },
```

- [ ] **Step 4: Type-check**

Run: `pnpm exec tsgo --noEmit` (or `pnpm lint`)
Expected: no errors. (The `createAnnotationToolButtons` generic now requires every union member, including `share`, to be present — confirming completeness.)

- [ ] **Step 5: Commit**

```bash
git add src/types/annotator.ts src/app/reader/components/annotator/AnnotationTools.tsx
git commit -m "feat(annotator): add 'share' annotation tool type and button (#4014)"
```

---

## Task 2: Pure toolbar helpers + tests

**Files:**
- Create: `src/utils/annotationToolbar.ts`
- Create: `src/__tests__/utils/annotationToolbar.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/utils/annotationToolbar.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  ALL_ANNOTATION_TOOL_TYPES,
  DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
  getToolbarToolTypes,
  getAvailableToolTypes,
  addToolToToolbar,
  removeToolFromToolbar,
  reorderToolbar,
} from '@/utils/annotationToolbar';

describe('annotationToolbar helpers', () => {
  test('ALL_ANNOTATION_TOOL_TYPES matches the button registry order', () => {
    expect(ALL_ANNOTATION_TOOL_TYPES).toEqual(annotationToolButtons.map((b) => b.type));
  });

  test('default toolbar is the eight non-share tools in canonical order', () => {
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).toEqual([
      'copy',
      'highlight',
      'annotate',
      'search',
      'dictionary',
      'translate',
      'tts',
      'proofread',
    ]);
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('share');
  });

  test('getToolbarToolTypes preserves order and falls back to default when undefined', () => {
    expect(getToolbarToolTypes(undefined, true)).toEqual(DEFAULT_ANNOTATION_TOOLBAR_ITEMS);
    expect(getToolbarToolTypes(['search', 'copy'], true)).toEqual(['search', 'copy']);
  });

  test('getToolbarToolTypes drops share when !canShare, keeps it when canShare', () => {
    expect(getToolbarToolTypes(['copy', 'share'], false)).toEqual(['copy']);
    expect(getToolbarToolTypes(['copy', 'share'], true)).toEqual(['copy', 'share']);
  });

  test('getToolbarToolTypes drops unknown/duplicate entries', () => {
    expect(getToolbarToolTypes(['copy', 'copy', 'bogus' as never], true)).toEqual(['copy']);
  });

  test('getAvailableToolTypes returns canonical-order complement', () => {
    expect(getAvailableToolTypes(['copy'], true)).toEqual([
      'highlight',
      'annotate',
      'search',
      'dictionary',
      'translate',
      'tts',
      'proofread',
      'share',
    ]);
  });

  test('getAvailableToolTypes hides share when !canShare', () => {
    expect(getAvailableToolTypes(['copy'], false)).not.toContain('share');
  });

  test('addToolToToolbar appends by default and is a no-op when present', () => {
    expect(addToolToToolbar(['copy'], 'share')).toEqual(['copy', 'share']);
    expect(addToolToToolbar(['copy', 'share'], 'share')).toEqual(['copy', 'share']);
  });

  test('addToolToToolbar inserts at the given index', () => {
    expect(addToolToToolbar(['copy', 'search'], 'share', 1)).toEqual(['copy', 'share', 'search']);
  });

  test('removeToolFromToolbar removes the tool', () => {
    expect(removeToolFromToolbar(['copy', 'share'], 'share')).toEqual(['copy']);
    expect(removeToolFromToolbar(['copy'], 'share')).toEqual(['copy']);
  });

  test('reorderToolbar moves a tool to another tool position', () => {
    expect(reorderToolbar(['copy', 'highlight', 'search'], 'search', 'copy')).toEqual([
      'search',
      'copy',
      'highlight',
    ]);
    expect(reorderToolbar(['copy', 'search'], 'copy', 'copy')).toEqual(['copy', 'search']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/utils/annotationToolbar.test.ts`
Expected: FAIL — `Cannot find module '@/utils/annotationToolbar'`.

- [ ] **Step 3: Implement the helpers**

Create `src/utils/annotationToolbar.ts`:

```typescript
import type { AnnotationToolType } from '@/types/annotator';

// Canonical order of every annotation tool. Kept in sync with
// `annotationToolButtons` in AnnotationTools.tsx (asserted by a unit test).
export const ALL_ANNOTATION_TOOL_TYPES: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'search',
  'dictionary',
  'translate',
  'tts',
  'proofread',
  'share',
];

// Default toolbar: the eight pre-existing tools in their original order.
// 'share' starts hidden in the Available tray per the #4014 design.
export const DEFAULT_ANNOTATION_TOOLBAR_ITEMS: AnnotationToolType[] = [
  'copy',
  'highlight',
  'annotate',
  'search',
  'dictionary',
  'translate',
  'tts',
  'proofread',
];

// Drop unknown/duplicate entries; fall back to the default when unset (a
// pre-existing per-book config may not carry the field yet).
const sanitize = (items: AnnotationToolType[] | undefined): AnnotationToolType[] => {
  const source = items ?? DEFAULT_ANNOTATION_TOOLBAR_ITEMS;
  const seen = new Set<AnnotationToolType>();
  const out: AnnotationToolType[] = [];
  for (const type of source) {
    if (ALL_ANNOTATION_TOOL_TYPES.includes(type) && !seen.has(type)) {
      seen.add(type);
      out.push(type);
    }
  }
  return out;
};

// Visible tools to render in the live selection toolbar, in order.
export const getToolbarToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
): AnnotationToolType[] => sanitize(items).filter((type) => canShare || type !== 'share');

// Hidden tools (the "Available" tray), in canonical order.
export const getAvailableToolTypes = (
  items: AnnotationToolType[] | undefined,
  canShare: boolean,
): AnnotationToolType[] => {
  const visible = new Set(sanitize(items));
  return ALL_ANNOTATION_TOOL_TYPES.filter(
    (type) => !visible.has(type) && (canShare || type !== 'share'),
  );
};

// Add `type` to the visible list at `atIndex` (default: end). No-op if present.
export const addToolToToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
  atIndex?: number,
): AnnotationToolType[] => {
  if (visible.includes(type)) return visible;
  const next = [...visible];
  next.splice(atIndex ?? next.length, 0, type);
  return next;
};

// Remove `type` from the visible list. No-op if absent.
export const removeToolFromToolbar = (
  visible: AnnotationToolType[],
  type: AnnotationToolType,
): AnnotationToolType[] => visible.filter((type_) => type_ !== type);

// Move `fromType` to where `toType` currently sits within the visible list.
export const reorderToolbar = (
  visible: AnnotationToolType[],
  fromType: AnnotationToolType,
  toType: AnnotationToolType,
): AnnotationToolType[] => {
  const from = visible.indexOf(fromType);
  const to = visible.indexOf(toType);
  if (from < 0 || to < 0 || from === to) return visible;
  const next = [...visible];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/utils/annotationToolbar.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/annotationToolbar.ts src/__tests__/utils/annotationToolbar.test.ts
git commit -m "feat(annotator): add pure toolbar order/visibility helpers (#4014)"
```

---

## Task 3: Add the `annotationToolbarItems` view setting + default

**Files:**
- Modify: `src/types/book.ts`
- Modify: `src/services/constants.ts`
- Modify: `src/__tests__/services/constants.test.ts`

- [ ] **Step 1: Write the failing assertion**

In `src/__tests__/services/constants.test.ts`, inside the existing `describe('DEFAULT_ANNOTATOR_CONFIG', ...)` block (around line 704), add a test. Add the import alongside the existing `DEFAULT_ANNOTATOR_CONFIG` import at the top of the file:

```typescript
import { DEFAULT_ANNOTATION_TOOLBAR_ITEMS } from '@/utils/annotationToolbar';
```

Then add inside the describe block:

```typescript
    test('annotationToolbarItems defaults to the eight non-share tools', () => {
      expect(DEFAULT_ANNOTATOR_CONFIG.annotationToolbarItems).toEqual(
        DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
      );
      expect(DEFAULT_ANNOTATOR_CONFIG.annotationToolbarItems).not.toContain('share');
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/__tests__/services/constants.test.ts`
Expected: FAIL — `annotationToolbarItems` is `undefined` (and a tsgo error that it's not on the type).

- [ ] **Step 3: Add the field to the type**

In `src/types/book.ts`, add to the `AnnotatorConfig` interface (after `annotationQuickAction`):

```typescript
export interface AnnotatorConfig {
  enableAnnotationQuickActions: boolean;
  annotationQuickAction: AnnotationToolType | null;
  annotationToolbarItems: AnnotationToolType[];
  copyToNotebook: boolean;
  noteExportConfig: NoteExportConfig;
}
```

Confirm `AnnotationToolType` is already imported in `book.ts` (it is — `annotationQuickAction` uses it).

- [ ] **Step 4: Add the default value**

In `src/services/constants.ts`, add the import near the other imports:

```typescript
import { DEFAULT_ANNOTATION_TOOLBAR_ITEMS } from '@/utils/annotationToolbar';
```

Then add the field to `DEFAULT_ANNOTATOR_CONFIG`:

```typescript
export const DEFAULT_ANNOTATOR_CONFIG: AnnotatorConfig = {
  enableAnnotationQuickActions: true,
  annotationQuickAction: null,
  annotationToolbarItems: DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
  copyToNotebook: false,
  noteExportConfig: DEFAULT_NOTE_EXPORT_CONFIG,
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/__tests__/services/constants.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check the whole project**

Run: `pnpm exec tsgo --noEmit`
Expected: no errors. (Confirms `DEFAULT_ANNOTATOR_CONFIG` still satisfies `AnnotatorConfig` and no test fixtures broke — fixtures spread `...DEFAULT_ANNOTATOR_CONFIG`, so they inherit the new field.)

- [ ] **Step 7: Commit**

```bash
git add src/types/book.ts src/services/constants.ts src/__tests__/services/constants.test.ts
git commit -m "feat(annotator): add annotationToolbarItems view setting (#4014)"
```

---

## Task 4: Share-text ladder helper + tests

**Files:**
- Create: `src/utils/share.ts`
- Create: `src/__tests__/utils/share.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/utils/share.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const shareTextMock = vi.fn().mockResolvedValue(undefined);
const writeClipboardMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@choochmeque/tauri-plugin-sharekit-api', () => ({
  shareText: (...args: unknown[]) => shareTextMock(...args),
}));

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeClipboardMock(...args),
}));

import { shareSelectedText } from '@/utils/share';

describe('shareSelectedText', () => {
  beforeEach(() => {
    shareTextMock.mockClear().mockResolvedValue(undefined);
    writeClipboardMock.mockClear().mockResolvedValue(undefined);
    // @ts-expect-error - reset between tests
    delete globalThis.navigator.share;
  });

  afterEach(() => {
    // @ts-expect-error - cleanup
    delete globalThis.navigator.share;
  });

  test('no-op on empty text', async () => {
    await shareSelectedText('', undefined, { isMobileApp: true });
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('uses native shareText on mobile', async () => {
    await shareSelectedText('hello', { x: 1, y: 2 }, { isMobileApp: true });
    expect(shareTextMock).toHaveBeenCalledWith('hello', { position: { x: 1, y: 2 } });
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('uses native shareText on macOS desktop', async () => {
    await shareSelectedText('hello', undefined, { isMacOSApp: true });
    expect(shareTextMock).toHaveBeenCalledTimes(1);
  });

  test('does NOT use native shareText on Windows/Linux; falls to navigator.share', async () => {
    const navShare = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error - test stub
    globalThis.navigator.share = navShare;
    await shareSelectedText('hello', undefined, { isWindowsApp: true, hasWindow: true });
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(navShare).toHaveBeenCalledWith({ text: 'hello' });
  });

  test('falls back to navigator.share when not a native share platform', async () => {
    const navShare = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error - test stub
    globalThis.navigator.share = navShare;
    await shareSelectedText('hello', undefined, null);
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(navShare).toHaveBeenCalledWith({ text: 'hello' });
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('swallows navigator.share rejection (user dismissed) without clipboard fallback', async () => {
    const navShare = vi.fn().mockRejectedValue(new Error('AbortError'));
    // @ts-expect-error - test stub
    globalThis.navigator.share = navShare;
    await expect(shareSelectedText('hello', undefined, null)).resolves.toBeUndefined();
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  test('falls back to clipboard when no share method exists', async () => {
    await shareSelectedText('hello', undefined, null);
    expect(shareTextMock).not.toHaveBeenCalled();
    expect(writeClipboardMock).toHaveBeenCalledWith('hello');
  });

  test('falls back to navigator.share when native shareText throws', async () => {
    shareTextMock.mockRejectedValueOnce(new Error('plugin unavailable'));
    const navShare = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error - test stub
    globalThis.navigator.share = navShare;
    await shareSelectedText('hello', undefined, { isMobileApp: true });
    expect(navShare).toHaveBeenCalledWith({ text: 'hello' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/utils/share.test.ts`
Expected: FAIL — `Cannot find module '@/utils/share'`.

- [ ] **Step 3: Implement the helper**

Create `src/utils/share.ts`:

```typescript
import { writeTextToClipboard } from '@/utils/clipboard';

export interface SharePosition {
  x: number;
  y: number;
  preferredEdge?: 'top' | 'bottom' | 'left' | 'right';
}

/** Minimal slice of AppService needed to decide the native-share path. */
interface ShareCapableService {
  isMobileApp?: boolean;
  isMacOSApp?: boolean;
  isWindowsApp?: boolean;
  isLinuxApp?: boolean;
  hasWindow?: boolean;
}

/**
 * Open the OS share sheet for `text`, with graceful fallbacks.
 *
 * Ladder:
 *  1. Native sharekit on mobile + macOS only. Windows/Linux are excluded: the
 *     plugin's share UI can freeze the app on Windows (issue #4343) and is not
 *     functional on Linux — `nativeAppService` gates `shareFile` the same way.
 *  2. `navigator.share` (web / PWA). A rejection means the user dismissed the
 *     sheet — respect it, don't silently copy.
 *  3. Clipboard, as a last resort when no share method exists.
 */
export const shareSelectedText = async (
  text: string,
  position?: SharePosition,
  appService?: ShareCapableService | null,
): Promise<void> => {
  if (!text) return;

  if (appService?.isMobileApp || appService?.isMacOSApp) {
    try {
      const { shareText } = await import('@choochmeque/tauri-plugin-sharekit-api');
      await shareText(text, { position });
      return;
    } catch (err) {
      console.error('shareText failed; falling back:', err);
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
    } catch {
      // User dismissed or share-time error; respect the choice.
    }
    return;
  }

  await writeTextToClipboard(text);
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/utils/share.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/share.ts src/__tests__/utils/share.test.ts
git commit -m "feat(annotator): add shareSelectedText ladder helper (#4014)"
```

---

## Task 5: Wire Share + toolbar filtering into the live Annotator

**Files:**
- Modify: `src/app/reader/components/annotator/Annotator.tsx`

> No new unit test: `Annotator.tsx` is a large composed component with heavy
> runtime deps; its testable logic already lives in the Task 2/4 helpers.
> Verification here is tsgo + lint + the manual check in Task 8.

- [ ] **Step 1: Add imports**

Near the other `@/utils` imports in `Annotator.tsx` (e.g. by the `writeTextToClipboard` import on line ~50), add:

```typescript
import { shareSelectedText } from '@/utils/share';
import { getToolbarToolTypes } from '@/utils/annotationToolbar';
import { AnnotationToolType } from '@/types/annotator';
```

(If `AnnotationToolType` is already imported in the file, do not duplicate it — only add the two `@/utils` imports.)

- [ ] **Step 2: Add `canShare` and `handleShare` near the other handlers**

Add right after `handleCopy` (it ends around line 884, before the `copyToNotebook` early return logic finishes — place this as a new top-level const within the component, e.g. just after the full `handleCopy` definition):

```typescript
  const canShare =
    !!appService?.isMobileApp ||
    !!appService?.isMacOSApp ||
    (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

  const handleShare = () => {
    if (!selection?.text) return;
    const position = trianglePosition
      ? {
          x: trianglePosition.point.x,
          y: trianglePosition.point.y,
          preferredEdge: 'bottom' as const,
        }
      : undefined;
    void shareSelectedText(selection.text, position, appService);
    handleDismissPopupAndSelection();
  };
```

- [ ] **Step 3: Add the quick-action case**

In `handleQuickAction`'s `switch (action)` block (around line 720), add a case (after the `tts` case):

```typescript
        case 'share':
          handleShare();
          break;
```

- [ ] **Step 4: Replace the `toolButtons` builder with a filtered/ordered one**

Replace the existing `const toolButtons = annotationToolButtons.map(({ type, label, Icon }) => { switch (type) { ... } });` block (around lines 1449-1491) with:

```typescript
  const buildToolButton = (type: AnnotationToolType) => {
    const def = annotationToolButtons.find((button) => button.type === type);
    if (!def) return null;
    const { label, Icon } = def;
    switch (type) {
      case 'copy':
        return { tooltipText: _(label), Icon, onClick: handleCopy };
      case 'highlight':
        return {
          tooltipText: selectionAnnotated ? _('Delete Highlight') : _(label),
          Icon: selectionAnnotated ? RiDeleteBinLine : Icon,
          onClick: handleHighlight,
        };
      case 'annotate':
        return { tooltipText: _(label), Icon, onClick: handleAnnotate };
      case 'search':
        return { tooltipText: _(label), Icon, onClick: handleSearch };
      case 'dictionary':
        return { tooltipText: _(label), Icon, onClick: handleDictionary };
      case 'translate':
        return { tooltipText: _(label), Icon, onClick: handleTranslation };
      case 'tts':
        return { tooltipText: _(label), Icon, onClick: handleSpeakText };
      case 'proofread':
        return {
          tooltipText: _(label),
          Icon,
          onClick: handleProofread,
          disabled: bookData.book?.format !== 'EPUB',
        };
      case 'share':
        return { tooltipText: _(label), Icon, onClick: handleShare };
      default:
        return null;
    }
  };

  const toolButtons = getToolbarToolTypes(viewSettings.annotationToolbarItems, canShare)
    .map(buildToolButton)
    .filter((button): button is NonNullable<typeof button> => button !== null);
```

- [ ] **Step 5: Type-check and lint**

Run: `pnpm lint`
Expected: no errors. (Confirms the `viewSettings.annotationToolbarItems` access, the new handlers, and the `toolButtons` shape all type-check against `AnnotationPopup`'s `buttons` prop.)

- [ ] **Step 6: Commit**

```bash
git add src/app/reader/components/annotator/Annotator.tsx
git commit -m "feat(annotator): render Share tool and honor toolbar order in selection popup (#4014)"
```

---

## Task 6: The drag-and-drop customizer sub-page

**Files:**
- Create: `src/components/settings/AnnotationToolbarCustomizer.tsx`

> Verification is tsgo + lint + the manual drag/tap check in Task 8. The state
> transitions reuse the Task 2 helpers (already unit-tested).

- [ ] **Step 1: Create the component**

Create `src/components/settings/AnnotationToolbarCustomizer.tsx`:

```typescript
import clsx from 'clsx';
import React, { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import { AnnotationToolType } from '@/types/annotator';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  getAvailableToolTypes,
  getToolbarToolTypes,
  addToolToToolbar,
  removeToolFromToolbar,
  reorderToolbar,
} from '@/utils/annotationToolbar';
import SubPageHeader from './SubPageHeader';

interface AnnotationToolbarCustomizerProps {
  bookKey: string;
  onBack: () => void;
}

const toolButtonOf = (type: AnnotationToolType) =>
  annotationToolButtons.find((button) => button.type === type);

interface ToolChipProps {
  type: AnnotationToolType;
  label: string;
  onActivate: () => void;
  _: (key: string) => string;
}

const ToolChip: React.FC<ToolChipProps> = ({ type, label, onActivate, _ }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: type,
  });
  const Icon = toolButtonOf(type)?.Icon;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      type='button'
      style={style}
      // Tap = move between zones; press-and-drag = reorder/move (the sensors'
      // activation constraints distinguish the two). Keeps the action usable
      // on e-ink and for keyboard/AT users where drag is impractical.
      onClick={onActivate}
      className={clsx(
        'eink-bordered flex touch-none select-none items-center gap-1.5 rounded-md px-2.5 py-1.5',
        'cursor-grab text-sm active:cursor-grabbing',
        isDragging ? 'z-10 shadow-md' : '',
      )}
      aria-label={label}
      title={_('Drag to reorder, tap to move')}
      {...attributes}
      {...listeners}
    >
      {Icon ? <Icon className='h-4 w-4 shrink-0' /> : null}
      <span className='whitespace-nowrap'>{label}</span>
    </button>
  );
};

const Zone: React.FC<{
  id: 'toolbar' | 'available';
  items: AnnotationToolType[];
  emptyHint: string;
  renderChip: (type: AnnotationToolType) => React.ReactNode;
}> = ({ id, items, emptyHint, renderChip }) => {
  const { setNodeRef } = useDroppable({ id });
  return (
    <SortableContext items={items} strategy={horizontalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={clsx(
          'bg-base-200/60 flex min-h-14 flex-wrap items-center gap-2 rounded-lg p-2',
        )}
      >
        {items.length === 0 ? (
          <span className='text-base-content/50 px-1 text-sm'>{emptyHint}</span>
        ) : (
          items.map((type) => <React.Fragment key={type}>{renderChip(type)}</React.Fragment>)
        )}
      </div>
    </SortableContext>
  );
};

const AnnotationToolbarCustomizer: React.FC<AnnotationToolbarCustomizerProps> = ({
  bookKey,
  onBack,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const canShare =
    !!appService?.isMobileApp ||
    !!appService?.isMacOSApp ||
    (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

  const [toolbar, setToolbar] = useState<AnnotationToolType[]>(() =>
    getToolbarToolTypes(viewSettings.annotationToolbarItems, canShare),
  );
  const [available, setAvailable] = useState<AnnotationToolType[]>(() =>
    getAvailableToolTypes(viewSettings.annotationToolbarItems, canShare),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const persist = (nextToolbar: AnnotationToolType[]) => {
    saveViewSettings(envConfig, bookKey, 'annotationToolbarItems', nextToolbar, false, true);
  };

  const containerOf = (id: string): 'toolbar' | 'available' | null => {
    if (id === 'toolbar' || toolbar.includes(id as AnnotationToolType)) return 'toolbar';
    if (id === 'available' || available.includes(id as AnnotationToolType)) return 'available';
    return null;
  };

  const moveToToolbar = (type: AnnotationToolType, atIndex?: number) => {
    const next = addToolToToolbar(toolbar, type, atIndex);
    setToolbar(next);
    setAvailable(getAvailableToolTypes(next, canShare));
    persist(next);
  };

  const moveToAvailable = (type: AnnotationToolType) => {
    const next = removeToolFromToolbar(toolbar, type);
    setToolbar(next);
    setAvailable(getAvailableToolTypes(next, canShare));
    persist(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as AnnotationToolType;
    const overId = over.id as string;
    const from = containerOf(active.id as string);
    const to = containerOf(overId);
    if (!from || !to) return;

    if (from === 'toolbar' && to === 'toolbar') {
      if (overId === 'toolbar' || overId === activeId) return;
      const next = reorderToolbar(toolbar, activeId, overId as AnnotationToolType);
      if (next !== toolbar) {
        setToolbar(next);
        persist(next);
      }
      return;
    }
    if (from === 'available' && to === 'toolbar') {
      const insertAt =
        overId === 'toolbar' ? toolbar.length : Math.max(0, toolbar.indexOf(overId as AnnotationToolType));
      moveToToolbar(activeId, insertAt);
      return;
    }
    if (from === 'toolbar' && to === 'available') {
      moveToAvailable(activeId);
      return;
    }
    // from === 'available' && to === 'available': display-only, ignore.
  };

  const renderToolbarChip = (type: AnnotationToolType) => (
    <ToolChip
      type={type}
      label={_(toolButtonOf(type)?.label ?? type)}
      onActivate={() => moveToAvailable(type)}
      _={_}
    />
  );
  const renderAvailableChip = (type: AnnotationToolType) => (
    <ToolChip
      type={type}
      label={_(toolButtonOf(type)?.label ?? type)}
      onActivate={() => moveToToolbar(type)}
      _={_}
    />
  );

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Behavior')}
        currentLabel={_('Customize Toolbar')}
        description={_(
          'Drag tools between the rows to show or hide them and reorder the toolbar. You can also tap a tool to move it.',
        )}
        onBack={onBack}
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className='my-4 space-y-5'>
          <div className='space-y-2'>
            <div className='text-base-content/70 text-sm font-medium'>{_('In toolbar')}</div>
            <Zone
              id='toolbar'
              items={toolbar}
              emptyHint={_('No tools — drag one here.')}
              renderChip={renderToolbarChip}
            />
          </div>
          <div className='space-y-2'>
            <div className='text-base-content/70 text-sm font-medium'>{_('Available')}</div>
            <Zone
              id='available'
              items={available}
              emptyHint={_('All tools are in the toolbar.')}
              renderChip={renderAvailableChip}
            />
          </div>
        </div>
      </DndContext>
    </div>
  );
};

export default AnnotationToolbarCustomizer;
```

- [ ] **Step 2: Type-check and lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/AnnotationToolbarCustomizer.tsx
git commit -m "feat(settings): add drag-and-drop annotation toolbar customizer (#4014)"
```

---

## Task 7: Hook the customizer into the Behavior panel

**Files:**
- Modify: `src/components/settings/ControlPanel.tsx`

- [ ] **Step 1: Add imports**

In `ControlPanel.tsx`, add `NavigationRow` to the existing primitives import and import the new component + the default constant:

```typescript
import { BoxedList, NavigationRow, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';
import AnnotationToolbarCustomizer from './AnnotationToolbarCustomizer';
import { DEFAULT_ANNOTATION_TOOLBAR_ITEMS } from '@/utils/annotationToolbar';
```

(The current import is `import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';` — just add `NavigationRow` to it.)

- [ ] **Step 2: Add sub-page state**

Add alongside the other `useState` hooks in the component body (e.g. after `annotationQuickAction`):

```typescript
  const [showToolbarCustomizer, setShowToolbarCustomizer] = useState(false);
```

- [ ] **Step 3: Reset the toolbar order on panel reset**

In `handleReset`, after the `resetToDefaults({...})` call and before `pageTurnerResetRef.current();`, add:

```typescript
    saveViewSettings(
      envConfig,
      bookKey,
      'annotationToolbarItems',
      DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
      false,
      true,
    );
```

- [ ] **Step 4: Early-return the sub-page**

Immediately before the main `return (` of the component (after all hooks/handlers), add:

```typescript
  if (showToolbarCustomizer) {
    return (
      <AnnotationToolbarCustomizer
        bookKey={bookKey}
        onBack={() => setShowToolbarCustomizer(false)}
      />
    );
  }
```

- [ ] **Step 5: Add the NavigationRow into the "Annotation Tools" BoxedList**

Inside the existing `<BoxedList title={_('Annotation Tools')} ...>` block, after the `Copy to Notebook` `SettingsSwitchRow`, add:

```typescript
        <NavigationRow
          title={_('Customize Toolbar')}
          onClick={() => setShowToolbarCustomizer(true)}
          data-setting-id='settings.control.customizeToolbar'
        />
```

- [ ] **Step 6: Type-check and lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/ControlPanel.tsx
git commit -m "feat(settings): open the toolbar customizer from the Behavior panel (#4014)"
```

---

## Task 8: Full verification + manual sanity

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm test`
Expected: PASS (no regressions; the new `annotationToolbar`, `share`, and `constants` tests pass).

- [ ] **Step 2: Lint + type-check**

Run: `pnpm lint`
Expected: PASS (Biome + tsgo, web only). No Rust/Lua files changed, so those lanes are not triggered.

- [ ] **Step 3: Manual sanity in dev-web**

Run: `pnpm dev-web`, open a book, then:
- Select text → confirm the toolbar shows the configured tools in order; **Share is absent by default**.
- Settings → Behavior → Annotation Tools → **Customize Toolbar**: drag `Share` from "Available" into "In toolbar"; reorder a couple of tools; drag one back out. Confirm taps also move tools between rows.
- Re-select text in the reader → confirm the toolbar reflects the new set/order, and **Share opens the OS share sheet** (or, on web without `navigator.share`, copies as a last resort).
- Toggle E-ink (Settings → Behavior → Device, or Misc) and reopen the customizer → confirm chips have visible 1px borders and remain legible.
- Behavior panel **Reset** → confirm the toolbar returns to the default eight tools (Share hidden).

- [ ] **Step 4: i18n extraction + translation (new strings)**

Run: `pnpm i18n:extract` to pick up the new `_()` strings (`Share`, `Share text after selection`, `Customize Toolbar`, `In toolbar`, `Available`, `No tools — drag one here.`, `All tools are in the toolbar.`, `Drag to reorder, tap to move`, and the SubPageHeader description). This adds the keys with `__STRING_NOT_TRANSLATED__` placeholders across `public/locales/*/translation.json`. Then run the **`/i18n` skill** to fill the placeholders (it translates all locales). New strings are non-plural/non-proper-noun, so `en/translation.json` needs no manual entry (defaultValue = key).

- [ ] **Step 5: Final commit (if extraction changed files)**

```bash
git add public/locales
git commit -m "chore(i18n): extract annotation share/toolbar strings (#4014)"
```

---

## Notes for the implementer

- **Don't restructure `Annotator.tsx`.** Only add the imports, `canShare`, `handleShare`, the quick-action case, and swap the `toolButtons` builder. Everything else stays.
- **`saveViewSettings` last two args** are `(skipGlobal, applyStyles)`. Use `(…, false, true)` to write through to the global default and apply — matching the existing `annotationQuickAction` save.
- **Per-book vs global:** the customizer writes via `saveViewSettings(bookKey, …, skipGlobal=false)`, so it updates the global default and the current book, consistent with the other Behavior settings.
- **Reduced-motion / a11y:** every chip is both tappable (zone toggle) and draggable (reorder/move); keyboard users and e-ink rely on the tap path.
