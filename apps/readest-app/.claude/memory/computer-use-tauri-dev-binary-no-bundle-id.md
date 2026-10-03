---
name: computer-use-tauri-dev-binary-no-bundle-id
description: "`pnpm tauri dev` runs a BARE binary with NULL CFBundleIdentifier, so computer-use screenshots hide the window; wrap it in a throwaway .app to see and drive it."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 0906336d-a343-45b8-9f91-f732358c57da
  modified: 2026-09-18T15:26:18.253Z
---

Verifying a change in the real macOS app with computer-use: `pnpm tauri dev`
launches `target/debug/Readest` directly, **not** an `.app` bundle. Its
`CFBundleIdentifier` is NULL (`lsappinfo info -only bundleid <pid>`), so the
screenshot compositor's allowlist filter — which matches on bundle id — excludes
the window. `request_access` for "Readest" grants `com.bilingify.readest` and
does nothing for the dev binary: you get a desktop screenshot with the app
missing, while `System Events` happily reports a visible window at 0,25.

Fix without a 10-minute `tauri build`: a throwaway wrapper bundle in the
scratchpad.

```
Readest.app/Contents/Info.plist          # CFBundleIdentifier com.bilingify.readest,
                                         # CFBundleExecutable Readest
Readest.app/Contents/MacOS/Readest -> /Users/chrox/dev/readest/target/debug/Readest
```

Then start the frontend yourself (`pnpm dev`, which is
`dotenv -e .env.tauri -- next dev`) and `open -a <scratchpad>/Readest.app`. The
dev binary has the `devUrl` baked in at compile time, so it attaches to
localhost:3000 and everything — plugins, localStorage, the LocalSend sockets —
behaves normally.

Traps hit on the way:

- **Single instance**: the installed `/Applications/Readest.app` holds the lock;
  the dev build exits 0 immediately. `osascript -e 'quit app "Readest"'` first,
  and relaunch it afterwards to leave the machine as found.
- **Port 3000**: an orphaned `next dev` from an earlier session makes
  `beforeDevCommand` exit 1 (`Error The "beforeDevCommand" terminated with a
  non-zero status code`). `lsof -ti:3000 | xargs kill` first.
- **curl to localhost fails with exit 52 / empty reply** — `http_proxy` is set to
  `127.0.0.1:8118` in this shell. Use `curl --noproxy '*'`.
- **Stale shared `target/`**: `failed to read plugin permissions … /Users/chrox/dev/
  readest-<removed worktree>/…` means cached build-script output points at a
  deleted worktree. `grep -rl "<dead worktree>" target/debug/build | sed 's|/[^/]*$||' |
  sort -u | xargs rm -rf`.
- Reader UI: single click on a cover **selects**, double-click **opens**. The
  close-book "X" (top right of the reader header) is what returns to the library;
  `cmd+[` just turns pages, and the sidebar cover opens the image viewer.

Per-device prefs live in WKWebView localStorage, readable offline at
`~/Library/WebKit/com.bilingify.readest/WebsiteData/Default/*/*/LocalStorage/localstorage.sqlite3`
(`select key, quote(value) from ItemTable`; values are UTF-16). Deleting a key
with the app closed is how you test a **default** on a machine that already
stored a choice. Used by [[bookdrop-cue-priming-rang-on-reader-open-6271]].
