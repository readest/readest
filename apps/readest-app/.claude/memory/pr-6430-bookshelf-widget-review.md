---
name: pr-6430-bookshelf-widget-review
description: "PR #6430 configurable Android bookshelf widget (external, RedHatter) - reviewed 2026-09-28, changes requested; chrox wants widget = pointer to an existing bookshelf, not a per-widget shelf editor"
metadata:
  node_type: memory
  type: project
  originSessionId: 09d74a0e-39b0-427a-b2cc-b513cfa7c90b
  modified: 2026-09-28T12:07:50.520Z
---

PR #6430 (RedHatter, `feat/android-bookshelf-widget`) replaces the "currently reading" Android widget with a per-widget `BookshelfDefinition` edited in an in-app `/widget-settings` route (deep link `readest://widget-settings/{id}`, `moveTaskToBack`, MainActivity back-key UP change, widget-to-widget exclusivity). Reviewed + Xiaomi-tested 2026-09-28; review comment posted (COMMENTED, not approved).

**chrox's design call:** the settings duplicate the Bookshelves editor and confuse users. Wanted: widget stores only a `shelfId` (+ built-in "Currently reading" default), native list picker in the configure activity, grid from widget size, optional `requestPinAppWidget` "Add to home screen" only where supported. Removes the settings page, deep link, moveTaskToBack, back-key change.

**Blocking, device-VERIFIED:** renaming the receiver `ReadingWidgetProvider` -> `BookshelfWidgetProvider` makes AppWidgetService DELETE every placed widget on upgrade (placed 0.12.10 widget on Xiaomi, installed branch, instance gone from `dumpsys appwidget`). Fix = keep the old component name (subclass).

Other findings (code-traced): 240x360 ARGB tiles via setImageViewBitmap can exceed AOSP's `6*screenW*screenH` widget bitmap cap on 720p/e-ink -> uncaught IllegalArgumentException from updateAppWidget (same crash-every-launch class as [[widget-thumbnail-degenerate-cover-crash]]); launch-link gate never released if initLibrary throws (store libraryLoaded stays false); status group tiles send raw `name` not `displayName`; coverless book -> `failed>0` -> fingerprint never cached.

Xiaomi recipes that worked: MIUI widget picker = long-press empty home area -> Widgets (661,2141) -> "Android widgets" at bottom -> scroll, uiautomator dump for `text="Readest"`; `dumpsys appwidget` `Widgets:` section lists placed instances.

**Redesign built 2026-09-29** (chrox chose: shelf list + rows/cols steppers + titles checkbox; mosaic always on): worktree commit 0d917921a (rebased branch `pr-6430`), cherry-picked cleanly onto the real PR head as 1a6a47514 on local branch `pr-6430-push` (push = plain, no force; fork remote https fails, use SSH per [[worktree-new-rebases-pr-force-push]]). Design: native store keeps {shelfId, gridRows, gridColumns, showTitles}; app publishes `set_bookshelf_widget_catalog` (shelves + translated labels) even with no widget placed; snapshot carries `shelfId`, provider shows tap-to-open placeholder until it matches; configure dialog fires `bookshelf-widget-configured` plugin event so a running app refreshes at once; shelves evaluated via readBookshelves + evaluateBookshelves with targeted shelves force-enabled, deleted shelf -> `recent`; heading hidden only for `recent`. Removed widget-settings page, moveTaskToBack, MainActivity back-key change, extracted Bookshelves sections. Provider class = `ReadingWidgetProvider` (component name kept).

**Xiaomi-VERIFIED 2026-09-29:** released 0.12.10 widget placed -> install redesign -> instance SURVIVES (same id, ReadingWidgetProvider) and repopulates after app open; a Finished-books widget (id 25) was placed via the native picker on the device, not by me (presumably chrox), and rendered with heading + titles. NOT device-tested by me: configure dialog look, placeholder state, bitmap-cap downsampling, instrumented androidTests (not run). `pnpm test -- <file>` runs the WHOLE suite here; use `pnpm exec dotenv -e .env -e .env.test.local -- vitest run <file>`.

Worktrees and pr-6430/pr-6440 branches removed 2026-09-29 after both PRs merged. Related: [[mobile-reading-widgets]] [[bookshelves-review-2026-09-21]]

**Follow-up PR #6440 (RedHatter, 2026-09-29):** Material configure dialog + "Shelf name" toggle (`showShelfName`, default false; heading now native-controlled, JS always sends the name). chrox call: keep Edit ONLY when reconfiguring, drop Add. Pushed fd47706d7 (Shelf name i18n x34) + 71d4db336 (Edit gated on `BookshelfWidgetStore.hasInstanceSettings`; Edit = save RESULT_OK + finish, then open `readest://widget-edit-shelf/{id}`; Add link/handling removed). Xiaomi-VERIFIED: opening the app from a FIRST placement makes MIUI drop the widget (id stays bound, app keeps pushing bitmaps to it); reconfigure-Edit keeps it. CI runs only `cargo test -p Readest --lib`, so plugin `tests/*.rs` breakage slips through (catalog test was red on the PR head). MIUI picker trap: a scroll swipe over the Readest tile DRAGS it onto home = stray placements.

#6440 MERGED 2026-09-29 after a main merge (only the 34 locale files conflicted: take main + re-extract + restore "Shelf name"); a 3rd CodeRabbit finding fixed in 646ac029e (Edit request resolved against `draft`, not `base`, else a shelf deleted in the open editor crashed `draft.find(...)!`).
