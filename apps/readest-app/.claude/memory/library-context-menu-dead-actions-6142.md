---
name: library-context-menu-dead-actions-6142
description: "#6142 library context menu buttons did nothing on macOS/Windows in 0.12.8 — tauri inline Menu.new items lose their action channel; fix = MenuItem.new first"
metadata: 
  node_type: memory
  type: project
  originSessionId: 82451fd4-cc34-4185-b59b-6870bbc3c58d
  modified: 2026-09-08T01:32:24.002Z
---

**#6142 — every bookshelf context-menu button was a no-op on macOS + Windows in 0.12.8.**
Menu pops up, click dismisses it, nothing runs. MERGED as #6143 (37d7a5bf8). Repro + fix both verified live on macOS.

**Regression came from #6081** (`chore: bump tauri to version 2.11.5`, ee86510cc), which
moved `packages/tauri` `61a041281` → `3156d92b7` and picked up upstream tauri #15679
(`1417768f9`, *"menu channels are never cleaned up"*). Verify with
`git merge-base --is-ancestor <upstream-sha> <submodule-pin>`.

**Mechanism — the rule to remember:** `Menu.new({ items: [{ text, action }] })` builds each
inline item as a Rust **temporary**. `MenuItemPayload::create_item` registers the action
channel keyed by item id, hands an `Arc` clone to `MenuBuilder`, and `Menu::append` keeps
only muda's own item — so `MenuBuilder::build()` drops the last clone. Since #15679 that
drop calls `remove_menu_channel`, unregistering the channel that was just created.
`RunEvent::MenuEvent` then finds nothing to dispatch to. **Inline `{text, action}` item
payloads are dead on arrival; `MenuItem.new` items are owned by the webview resource table
and survive.** Still unfixed upstream (nothing after `1417768f9` on `upstream/dev`) — this
breaks every tauri app using the nested-object form.

**How to apply:** build items with `MenuItem.new` first, then one `Menu.new({ items })` —
order stays deterministic ([[bug-patterns]] #4389 Menu.append IPC race) and hover prewarm
hides the extra round-trips. The items are owned **separately** from the menu, so
`releaseMenu` must close each item too or every rebuild leaks a resource per entry.
Readest has exactly one native-menu call site (`BookshelfItem.tsx`); Linux already uses the
in-app `BookContextMenuPopup`.

**Driving the `pnpm tauri dev` app with computer-use on macOS:** the dev binary has a NULL
`CFBundleIdentifier`, so ScreenCaptureKit filters it out — screenshots show the desktop and
the window looks missing. Fix: `pnpm dev` for the Next server, then wrap
`target/debug/Readest` in a throwaway `.app` (Contents/Info.plist with
`CFBundleIdentifier=com.bilingify.readest` + `CFBundleExecutable=Readest`, binary symlinked
into Contents/MacOS) and `open` that. Clicks are gated on the frontmost window, so
`osascript -e 'tell application "System Events" to set visible of process "iTerm2" to false'`
before each interaction burst.

Related: [[tauri-fork-bump-workspace-exclude-swift-rs]], [[git-push-socks-proxy]].
