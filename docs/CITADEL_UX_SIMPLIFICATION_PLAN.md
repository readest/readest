# Citadel UX Simplification Plan (CT-011)

## 1) Current Problem Summary

The current library entry experience is powerful but dense:

- App opens directly to `library/page.tsx` with full shelf, topbar controls, search, import, view/sort/group options, selection mode, dialogs, sync/update affordances, and settings-heavy menus.
- `LibraryHeader.tsx` and `SettingsMenu.tsx` expose many controls at once, including advanced behavior toggles and system-level options.
- `BookshelfItem.tsx` / `BookItem.tsx` optimize for comprehensive management of a full collection, not a "calm first decision."
- Reader menu (`BookMenu.tsx`) is similarly feature-rich, which is valuable, but indicates the product defaults are currently "power user first."

Result: first impression feels like a management console rather than a focused reading companion.

## 2) Proposed Citadel Information Architecture

### Home / Continue Reading

Primary landing surface becomes a calmer home layer that prioritizes:

- Current/last book with one-click Continue.
- 3-6 recent books or active books.
- Lightweight secondary actions (Open Library, Import, Search).

Home should be visual and low-friction, not settings-heavy.

### Library

Library remains full-featured for catalog management:

- Full shelf/grid/list views.
- Grouping, sorting, filtering, selection mode.
- Bulk operations and advanced metadata/admin actions.

Library becomes intentional destination, not default cognitive load.

### Reader

Reader stays focused on reading with contextual controls:

- Keep existing progress, annotation, sync integrations.
- Keep reader command density available, but avoid expanding default visible chrome.

### Settings / Advanced

Keep all existing power features, but progressively disclose:

- Everyday controls in simple settings.
- Power/system/rarely used controls grouped under Advanced.
- Avoid exposing infrastructure-like options at first glance.

## 3) Controls That Should Stay Visible on Main Library Screen

Keep visible in primary top surface:

- Search field.
- Import action.
- Continue reading entry point (new Home surface primary CTA).
- Basic view switch (grid/list) and maybe sort shortcut.
- Settings entrypoint (single icon/button), not full settings exposure inline.

Optional but still acceptable:

- Lightweight sync indicator/progress only (no deep sync controls inline).

## 4) Controls/Settings to Move into Secondary Menus Later

Move from immediate visibility to secondary/advanced layers:

- Bulk select mode controls unless user explicitly enters select mode.
- System/window controls: Always on Top, Fullscreen, status bar behavior.
- Background/foreground Android-specific controls.
- Root data location, backup/restore, refresh metadata.
- Save book cover behavior and telemetry toggles.
- Premium/account operational details beyond a compact account entry.
- Advanced cloud/sync provider configuration from reader and library menus.

Principle: preserve capability, reduce default noise.

## 5) Proposed Phased Implementation

### Phase A — Visual Home/Library Hero

- Add a lightweight home layer above or before full shelf rendering.
- Show Current Reading + Continue CTA + recent strip.
- Keep a clear "Open Full Library" path.
- No data model rewrite; consume existing library/recent state.

### Phase B — Reduce Visible Toolbar Clutter

- Simplify header default controls to core actions.
- Move less-frequent controls into existing dropdowns.
- Keep parity in capability (no feature removal), only placement and priority changes.

### Phase C — Settings Grouping / Advanced Options

- Reorganize settings into Basic vs Advanced sections.
- Keep existing setting keys and behavior untouched initially.
- Clarify labels and hierarchy; avoid logic changes in first pass.

### Phase D — Reader Companion Layer

- Introduce a calmer companion/sidebar pattern in reader context.
- Keep current reader behavior intact; layer companion affordances around it.
- Defer heavy interactions (AI/lore/deep customization) behind optional panels.

## 6) Risk Notes (What Not to Touch Yet)

Do not change during UX simplification planning/early implementation:

- Reader core behavior and rendering internals.
- Tauri/Rust/native plugin setup and permissions.
- Import/sync/storage/services/stores data contracts.
- Package/dependency architecture.
- Global CSS architecture rewrites.

High confidence path: rearrange surface hierarchy and visibility first, then iterate.

## 7) Suggested Next 3 Code Tasks (Scoped)

### CT-012 — Home/Continue Reading shell (no data-model changes)

**Likely inspect/edit scope:**

- `apps/readest-app/src/app/library/page.tsx`
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- `apps/readest-app/src/app/library/components/BookItem.tsx` (read-only if needed)
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

Goal: add a compact "Continue Reading" top section and a clear "Open Full Library" transition while preserving current bookshelf logic.

### CT-013 — Library header simplification pass

**Likely inspect/edit scope:**

- `apps/readest-app/src/app/library/components/LibraryHeader.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/library/page.tsx` (if wiring needed)
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

Goal: reduce default visible controls; keep advanced options in dropdown/secondary menus.

### CT-014 — Settings IA grouping (Basic vs Advanced)

**Likely inspect/edit scope:**

- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/app/reader/components/sidebar/BookMenu.tsx` (alignment pass, no behavior changes)
- `Agents/TASK_QUEUE.md`
- `Agents/AUDIT_LOG.md`

Goal: reorganize menu structure for progressive disclosure while preserving existing toggles and handlers.

---

This plan is documentation-only and intentionally avoids code/behavior changes.
