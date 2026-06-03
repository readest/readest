---
name: tauri-menu-append-race-4389
description: "Un-awaited Tauri Menu.append() races on IPC → context menu items shuffle order randomly; fix = single Menu.new({ items })"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8169b903-f66e-4c35-b90f-6b9110837588
---

#4389 — the bookshelf right-click context menu (Windows/Edge WebView2) showed the
same items but in a **randomly changing order** on every open.

**Root cause:** `Menu.append()` from `@tauri-apps/api/menu` returns `Promise<void>`
— each call is an async IPC round-trip to the Rust backend. `BookshelfItem.tsx`
fired ~11 `menu.append(item)` calls **without awaiting** (then `menu.popup()` also
un-awaited). The concurrent IPC requests resolve in non-deterministic order on the
Rust side, so items land shuffled. Synchronous JS call order is correct — the race
is purely in async resolution, which is why it's invisible in jsdom and only shows
on the native app.

**Fix:** build the items array in order and create the menu in ONE call:
`const menu = await Menu.new({ items })` then `await menu.popup()`.
`MenuOptions.items` / `append()` accept plain `MenuItemOptions` (`{ text, action }`)
arrays — no need to pre-create `MenuItem.new()` per item at all. Applied to both
book and group handlers.

**Testability:** extracted the order/inclusion logic into a pure
`getBookContextMenuItemIds(book): BookContextMenuItemId[]` in
`src/app/library/utils/libraryUtils.ts` (dep-light, already test-covered) so the
deterministic ordering is unit-testable without mounting the component or mocking
Tauri. Test: `src/__tests__/app/library/book-context-menu.test.ts`. The pure fn
guards the order contract; the `Menu.new({ items })` wiring is what kills the race.

**General lesson:** any un-awaited sequence of Tauri/IPC mutations that must stay
ordered (append, insert, etc.) is a latent race — batch into one call or await each.
See [[bug-patterns]].
