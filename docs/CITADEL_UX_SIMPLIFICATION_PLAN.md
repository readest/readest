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

## 6.5) Book opening behavior

### Current behavior

- Library opening behavior is controlled by `settings.openBookInNewWindow`.
- Click/open actions in `BookshelfItem.tsx` and multi-select open in `Bookshelf.tsx` open a separate reader window when this setting is true on desktop.
- The user-facing toggle lives in `SettingsMenu.tsx` and persists through system settings storage.

### Preferred Citadel behavior

- Default to same-window reading for calmer flow and fewer surprise popups.
- Keep separate-window opening available as an explicit opt-in for power users.
- Existing local installs may keep a previously saved separate-window preference until the user toggles it.

### Files involved

- `apps/readest-app/src/app/library/components/BookshelfItem.tsx`
- `apps/readest-app/src/app/library/components/Bookshelf.tsx`
- `apps/readest-app/src/app/library/components/SettingsMenu.tsx`
- `apps/readest-app/src/services/constants.ts` (default system settings source)

### Future risk notes

- Changing defaults in persisted settings must avoid migrating or overriding existing user preference.
- Any future change to default should be limited to new/fresh settings initialization paths only.

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

## 8) CT-018 implementation snapshot (Home vs Library split)

Implemented in this pass:

- `/` now renders a dedicated Home screen shell instead of rendering `library/page.tsx` directly.
- Home uses existing settings/library loading paths (`loadSettings`, `loadLibraryBooks`) with the same keep-login guard assumptions.
- Home exposes primary Continue action when a current book is available, fallback guidance otherwise, plus Open Library and Import actions.
- Home includes a small recent-books preview using already loaded library data (no new data model contracts).
- `/library` remains the full management destination; search/sort/group/select/import/settings flows are preserved.
- Library header now includes a subtle Home affordance for back-navigation.

Remaining follow-up after CT-018:

- Visual tuning after Eddy review (spacing/contrast/copy refinements).
- Confirm Home import CTA behavior on all target platforms in manual QA.
- Decide whether Home should eventually show richer progress metadata or keep the lightweight preview.

## 9) CT-019 implementation snapshot (Home visual pass 1)

Implemented in this pass:

- Improved Home hero contrast/readability while keeping the dark Citadel mood (stronger heading/body contrast, less muddy panel treatment).
- Continue area now supports visual cover presentation using existing cover fields through shared `BookCover` behavior (`metadata.coverImageUrl` then `coverImageUrl`).
- Added explicit fallback cover blocks for missing images in both Continue hero and Recent preview cards.
- Recent preview now shows compact cover thumbnails plus title/author metadata, while staying lighter than full Library management cards.
- Reduced heavy gold-outline repetition by using neutral borders with gold as accent/interaction cue.
- Refined wide-screen composition with a two-column Continue layout (cover + reading info/actions) and cleaner spacing rhythm.

Remaining ideas after CT-019:

- Optional progress-aware micro-metadata in Home Continue panel (only if still calm and low-density).
- Optional richer typography tuning once Eddy confirms baseline contrast/spacing across light/dark/system themes.

## 10) CT-021 implementation snapshot (Currently Reading showcase + bottom shelf)

Implemented in this pass:

- Reworked Home below the shared topbar into a central, cover-first **Currently Reading** showcase (reduced dashboard-card feel).
- Featured cover is now the primary visual anchor; title/author are presented beneath with stronger neutral contrast.
- Added optional reading progress row + bar when `continueBook.progress` is available (normalized for both 0..1 and 0..100 style values).
- Kept Home topbar/search/window controls unchanged.
- Reworked Recent/Library preview into a fuller bottom horizontal cover shelf (book covers primary, title/author secondary) with horizontal scrolling on smaller widths.
- Preserved Home search filtering and no-results behavior; when search is active, shelf shows matching subset only.

Remaining ideas after CT-021:

- Optional subtle backdrop/ambient treatment behind the central showcase if Eddy wants more cinematic depth.
- Optional shelf-size tuning (cover heights/spacing) after fullscreen and narrow-window visual review.

## 11) CT-022 implementation snapshot (Atmospheric stage + anchored shelf)

Implemented in this pass:

- Shifted Home below topbar from neutral dashboard styling to a restrained atmospheric stage using layered gradients (subtle radial glow behind hero cover, darker edge falloff).
- Kept shared topbar unchanged; all work stayed in Home content composition.
- Made featured book the clear hero with responsive `clamp` sizing, stronger cover shadow/rim treatment, readable title/author, and progress row/bar when progress data exists.
- Promoted **Continue reading** to the primary nearby action under the showcase; kept import as secondary.
- Reworked bottom section into a true anchored shelf/dock: subtle top border/background strip, cover-first horizontal row, compact metadata, responsive horizontal scroll.
- Preserved Home search behavior and no-results messaging; shelf label now reads **Search Results** when search is active.

Remaining ideas after CT-022:

- Optional micro-motion/polish for shelf hover and hero transitions once visual baseline is approved.
- Optional dynamic shelf count tuning by viewport width if Eddy wants denser fullscreen rows.

## 12) CT-023 implementation snapshot (Design-system alignment pass)

Implemented in this pass:

- Aligned Home stage to near-black Citadel tones (`#0a0a0c` / `#131315`) with restrained atmospheric gradients and improved contrast hierarchy.
- Removed the fullscreen scrollbar condition by switching Home to viewport-fit flex composition (no `overflow-auto` on main surface and reduced vertical padding/min-height pressure in stage layout).
- Added a subtle cover-reactive ambient layer using the current book cover URL (blurred, low-opacity, darkened wash) with gradient fallback still present.
- Improved typography/readability with serif-styled featured title (`Georgia/Palatino` fallback), parchment primary text (`#f0ede4`), and secondary/tertiary metadata colors (`#8a8883` / `#6b6a66`).
- Darkened topbar appearance via page-level class overrides only (structure and controls unchanged).
- Increased shelf cover size and dock presence for a more substantial bottom anchored shelf while preserving horizontal scrolling and search/no-results behavior.
- Softened cover framing by removing harsher ring accents and using low-contrast borders + softer shadows.

Remaining ideas after CT-023:

- Optional cover-color extraction for more color-accurate reactive glow beyond full-image blur wash.
- Optional fine-tuning of shelf card dimensions if Eddy wants denser compact mode for smaller laptop windows.

## 13) CT-024 implementation snapshot (Focused Home refinement)

Implemented in this pass:

- Increased cover-reactive stage visibility with stronger layered ambient treatment (higher opacity + blur-tuned cover wash + extra radial aura) while keeping overall stage dark.
- Darkened Home topbar further through Home page class overrides only (no structure/content changes).
- Expanded bottom shelf dock footprint (wider max layout, roomier padding, larger cover tiles).
- Improved non-fullscreen behavior by reducing hero vertical pressure (smaller clamp floor, tighter spacing) and preserving viewport-fit composition.
- Fixed shelf clipping risk by making the shelf section non-shrinking (`flex-shrink-0`) and adding safer vertical padding inside the scroll row.
- Preserved Home search filtering/no-results behavior and existing CTA/buttons.

## 14) CT-025 implementation snapshot (Editorial split hero target pass)

Implemented in this pass:

- Reworked Home hero composition into target-style editorial split: **left column** carries currently-reading label, large serif title, author metadata, optional progress, and Continue/Import CTAs; **right column** is a large featured cover.
- Kept topbar structure/behavior unchanged (search flow, Library button, window controls).
- Darkened stage mood further with denser vignette layers and stronger atmospheric contrast.
- Strengthened cover-reactive ambiance with heavier blur/saturation and warmer right-biased radial wash anchored around the featured cover region.
- Expanded bottom shelf into a wider, larger dock-like strip with bigger cover-first tiles while preserving horizontal scrolling and search/no-results behavior.

Verification focus:

- Hero orientation must remain title/metadata-left and cover-right.
- Continue/Import actions and search filtering behavior must stay unchanged.
- Shelf should feel larger and dock-like without clipping in non-fullscreen windows.

## 15) CT-025B implementation snapshot (Target layout polish only)

Implemented in this pass:

- Fixed Home topbar logo image sizing to preserve intrinsic aspect ratio and avoid browser aspect warnings (`height: auto` with fixed width styling; asset unchanged).
- Reduced editorial hero title clamp one step to better handle long titles while preserving serif display hierarchy.
- Rebalanced split hero presence by slightly increasing inter-column breathing room and modestly reducing featured cover clamp/weight (left/right orientation unchanged).
- Softened bottom shelf cover treatment by reducing border/shadow harshness and removing crisp image filter styling while keeping large cover size and no clipping.
- Increased `View all` link readability with a slightly brighter resting tone while keeping a subtle visual priority.
