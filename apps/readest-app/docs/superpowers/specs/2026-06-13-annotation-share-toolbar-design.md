# Share intent + customizable annotation toolbar (#4014)

**Issue:** [readest/readest#4014](https://github.com/readest/readest/issues/4014) — _FR: add share intent in mobile_

## Problem

When a user selects text in a book, the selection toolbar offers Copy, Highlight,
Annotate, Search, Dictionary, Translate, Speak, Proofread — but no way to send the
selection to another app (a dictionary, AI chat, Anki, a browser, a messenger).
"Copy" is a cumbersome stopgap that needs several extra taps to reach the target app.

A native **Share** action solves this. Adding it also surfaces a second concern: the
toolbar already shows 8 tools and renders them all unconditionally (scrollable on
narrow screens). A 9th tool worsens the crowding, and different users want different
tools up front (language learners want Dictionary + Share; others want Highlight +
Annotate). So alongside Share we let users **choose which tools appear and in what
order**.

## Goals

1. Add a **Share** tool to the selection toolbar that opens the native share sheet
   for the selected text, with a graceful web fallback.
2. Let users **customize the toolbar** — show/hide tools and reorder them — via a
   drag-and-drop sub-page in Settings → Behavior.

## Non-goals

- No new "share targets" management (we hand off to the OS share sheet; the OS owns
  the target list).
- No change to the existing Quick Action mechanism beyond making Share selectable as
  one.
- No per-platform toolbar presets; one customizable list, gated only by capability.

## Current architecture (as-is)

- **Tool definitions** — `src/app/reader/components/annotator/AnnotationTools.tsx`
  exports `annotationToolButtons` (ordered array of `{ type, label, tooltip, Icon,
  quickAction? }`) and `annotationToolQuickActions` (the `quickAction: true` subset).
- **Tool types** — `src/types/annotator.ts` `AnnotationToolType` union.
- **Toolbar rendering** — `Annotator.tsx` maps `annotationToolButtons` → `toolButtons`
  (a `switch` on `type` that binds each button's handler), passed to
  `AnnotationPopup`. Every button is rendered; there is no visibility filter today.
- **Quick action** — `handleQuickAction()` in `Annotator.tsx` runs a single tool
  immediately on selection when `enableAnnotationQuickActions` +
  `annotationQuickAction` are set.
- **Settings (Behavior panel)** — `src/components/settings/ControlPanel.tsx`
  (tab id `Control`, label "Behavior") already has an "Annotation Tools" `BoxedList`
  with Enable Quick Actions / Quick Action select / Copy to Notebook.
- **View-setting storage** — `AnnotatorConfig` in `src/types/book.ts`; defaults in
  `DEFAULT_ANNOTATOR_CONFIG` (`src/services/constants.ts`); persisted via
  `saveViewSettings` (global default, per-book overridable). Missing fields merge to
  the default.
- **Share plumbing (already present)** — `@choochmeque/tauri-plugin-sharekit-api`
  exposes `shareText(text, { position?, mimeType? })`. `ShareBookDialog.tsx` /
  `SharedLinksSection.tsx` already use it with the ladder: sharekit → `navigator.share`
  → clipboard. `appService` exposes `shareFile` but **not** a text-share method.
- **Drag-and-drop** — `@dnd-kit/core` + `/sortable` + `/utilities` are dependencies;
  `src/components/settings/CustomDictionaries.tsx` already implements drag-to-reorder
  with `DndContext` / `SortableContext` / `useSortable`.
- **Settings sub-pages** — a panel holds a `showX` boolean, early-returns
  `<SubPage onBack={...} />`, and exposes a `NavigationRow` to enter it (see
  `LangPanel.tsx` → `CustomDictionaries`, gated by `showCustomDictionaries`).

## Design

### 1. Share tool

- Add `'share'` to `AnnotationToolType` (`src/types/annotator.ts`).
- Add a `share` entry to `annotationToolButtons` (`AnnotationTools.tsx`):
  `label: _('Share')`, `tooltip: _('Share text after selection')`,
  `Icon: PiShareFat` (react-icons/pi), `quickAction: true`.
- **Share helper** — new helper `shareSelectedText(text, position?, appService?)` in
  `src/utils/share.ts`, that runs the ladder used by `ShareBookDialog`:
  1. If `appService?.isMobileApp || appService?.hasWindow`: dynamic-import
     `shareText` and call `shareText(text, { position })`. On success, return.
  2. Else/on throw: if `navigator.share` exists, `await navigator.share({ text })`
     (swallow `AbortError` — user dismissed). Return.
  3. Last resort: `writeTextToClipboard(text)`.
  Extracting this keeps the ladder unit-testable with the existing sharekit mock and
  keeps `Annotator.tsx` thin.
- **`handleShare()` in `Annotator.tsx`** — guards on `selection?.text`, computes an
  anchor `position` from `trianglePosition` (for the iPad/macOS popover; ignored on
  phones), calls `shareSelectedText(...)`, then `handleDismissPopupAndSelection()`.
  Wire it into the `toolButtons` `switch` (`case 'share'`) and the
  `handleQuickAction` `switch` (`case 'share'`).
- **Capability gating (`canShare`)** — a boolean derived from
  `appService?.isMobileApp || appService?.hasWindow ||
  (typeof navigator !== 'undefined' && !!navigator.share)`. When `false`, Share is
  omitted from both the live toolbar and the customizer (so we never show a "Share"
  that silently just copies).

### 2. Data model

- New field on `AnnotatorConfig` (`src/types/book.ts`):
  `annotationToolbarItems: AnnotationToolType[]` — the **ordered, visible** tools.
  "Available" (hidden) tools = all tool types minus this list, displayed in the
  canonical `annotationToolButtons` order.
- Default (`DEFAULT_ANNOTATOR_CONFIG`): the existing 8 tools in their current order,
  **without** `share`:
  `['copy', 'highlight', 'annotate', 'search', 'dictionary', 'translate', 'tts',
  'proofread']`.
  → Existing users keep their exact current toolbar after upgrade (missing-field
  merge → this default); Share starts hidden in the Available tray.
- **Forward-compat note:** a tool type added in a future release won't be in an
  existing user's saved array, so it defaults to "Available" (hidden) for them and
  visible only for fresh defaults. Acceptable; documented here so it's a deliberate
  choice, not a surprise.

### 3. Toolbar rendering

- A pure helper `getToolbarToolTypes(items, canShare)` returns the ordered list of
  tool types to render: it takes `annotationToolbarItems`, drops `'share'` when
  `!canShare`, and (defensively) drops any unknown types. `Annotator.tsx` builds
  `toolButtons` from this list instead of the full `annotationToolButtons`, looking
  up each type's handler. Unit-tested.

### 4. Settings customizer (sub-page)

- New component
  `src/components/settings/AnnotationToolbarCustomizer.tsx` with an `onBack` prop and
  a `SubPageHeader` (mirrors `CustomDictionaries`).
- `ControlPanel.tsx`: add `showToolbarCustomizer` state, early-return
  `<AnnotationToolbarCustomizer onBack={() => setShowToolbarCustomizer(false)} />`,
  and a `NavigationRow` (title `_('Customize Toolbar')`) inside the existing
  "Annotation Tools" `BoxedList`.
- **Two zones**, both rendering the real tool icon-buttons:
  - **"In toolbar"** — the ordered visible tools; drag to reorder.
  - **"Available"** — the hidden tools; drag one into "In toolbar" to add, drag a
    visible tool back to remove.
  Built with `@dnd-kit` using the multiple-containers (two droppable lists) pattern,
  reusing the sensor/handle conventions from `CustomDictionaries`.
- **Touch / e-ink / a11y affordance:** in addition to cross-zone drag, tapping a tool
  toggles it between zones (drag can be fiddly on e-ink and is invisible to keyboard
  users). Tapping an Available tool **appends** it to the end of "In toolbar"; tapping
  a visible tool moves it to "Available". Buttons use `eink-bordered`; hierarchy never
  relies on color/shadow alone.
- On every change, persist the new order via
  `saveViewSettings(envConfig, bookKey, 'annotationToolbarItems', next, false, true)`.
- Reset: include `annotationToolbarItems` in `ControlPanel`'s `handleReset` wiring so
  "Reset" restores the default order.

### 5. i18n

New `stubTranslation` strings (extracted later via the i18n workflow): `Share`,
`Share text after selection`, `Customize Toolbar`, and the customizer's zone labels
(`In toolbar`, `Available`) and `Drag to reorder` / drag hints. `en/translation.json`
needs no manual entry (no plurals/proper nouns).

## Testing (test-first)

1. `getToolbarToolTypes` — order preserved; `share` dropped when `!canShare`; unknown
   types dropped. (pure unit test)
2. The customizer's add/remove/reorder reducer — moving between zones and reordering
   produce the expected `annotationToolbarItems`. (pure unit test on the extracted
   reducer)
3. `shareSelectedText` ladder — with `@choochmeque/tauri-plugin-sharekit-api` mocked
   (mirrors `src/__tests__/services/native-app-service-share.test.ts`): calls
   `shareText` on mobile/window; falls back to `navigator.share`; falls back to
   clipboard when neither is available; swallows `AbortError`.
4. `DEFAULT_ANNOTATOR_CONFIG.annotationToolbarItems` shape/order assertion in
   `src/__tests__/services/constants.test.ts`.

## Verification (done-conditions)

- `pnpm test` (unit), `pnpm lint` (Biome + tsgo). No Rust/Lua files change, so those
  lanes are not triggered.
- Manual sanity in dev: select text → Share opens the sheet; customizer reorders /
  shows / hides and the live toolbar reflects it; e-ink toggle still legible.

## Out-of-scope / deferred

- Native Android `mimeType` refinements for Share (use the plugin default).
- Surfacing Share on desktop Linux where only the clipboard fallback exists
  (capability gating already hides it there).
