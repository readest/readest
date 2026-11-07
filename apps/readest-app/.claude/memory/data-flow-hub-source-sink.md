---
name: data-flow-hub-source-sink
description: "Settings > Integrations > Data Flow: descriptive source/sink connectors plus recordFlow, not a sync coordinator; branch feat/sync-data-flow"
metadata:
  node_type: memory
  type: project
  originSessionId: 831363b2-bc9b-47cc-98d2-5e1f29efe630
  modified: 2026-11-05T14:18:20.519Z
---

chrox asked 2026-11-05 for a source/sink view so each reader can see which integration works: sources left, sinks right, entry counts, connection health shown separately from sync history, in Settings > Integrations. MERGED #7366 (1bd151d92) 2026-11-05 UNRELEASED, by chrox; worktree and branch removed. The "can't reach from this device" state was dropped. On the Xiaomi 2026-11-06 the OPDS alarm for 192.168.2.120:25600 was TRUE: that host is chrox's Mac and nothing listens there, so it is no evidence of a browser-only false alarm. ABS 401 was also true: the real library sync fails the same way and the settings page's "Connected to 2.36.0" is the stored version, not a live check.

Code: `src/services/sync/dataFlow/{types,log,connectors}.ts`, UI `src/components/settings/integrations/DataFlowPage.tsx`. Per-device, localStorage key `readest-data-flow`.

**Why:** chrox asked whether a generic pull/push interface was needed. Decision: no pull()/push() coordinator, because the goal is visibility and rewriting ~3,800 lines of hooks with subtle gates risks regressions. Connectors describe; sync paths call `recordFlow()`. A coordinator (one conflict dialog, push blocking) can be added later and keep the connector list.

**How to apply:**
- A new integration needs a connector in `connectors.ts` plus `recordFlow()` on success and failure. `check` must be read-only: `KOSyncClient.connect` registers an account on 401, so use `checkConnection`.
- Cloud push counts compare against the book's own cursor when a book is open: the library cursor doesn't track it, and opening a book re-sends notes from before the look-back, so unchanged notes counted as sent (14 to 28 on one reopen).
- Status is per direction: a working pull must not hide a failing push, and only the failing side is flagged.
- chrox's rule: a book count means a FILE uploaded or downloaded (transferManager), never metadata rows, shelf rows or streaming stubs. Those record count 0 so the sync still shows as working.
- Never use `/send/inbox/claim` as a health check: it leases the oldest item with no release action. Check lists `GET /send/inbox`; the drainer reports real claim failures.
- Entry point is a low-profile icon in the Integrations header (chrox: a separate row is too heavy): info icon when fine, warning icon + count when not. Don't bring back a row or section. BookDrop still leads the panel (#6360).
- Obsidian's count is `changed` from mergeVaultNote (blocks added/rewritten/removed), never the highlight total: a book syncs on every open. Its check is `isDirectory`, because writes would dirty the vault.
- `pnpm run i18n:extract` also pulls in unrelated keys already untranslated on main: revert and add only the PR's own keys.

Verify recipe: dev-web on `localhost` (127.0.0.1 is rejected by Next's dev-origin guard), a stub KOSync on 127.0.0.1 with CORS, Playwright through the real form. To seed many integrations, patch `settings.json` in IndexedDB `AppFileSystem` store `files`. File backends need a paid plan on web, so they're gated out of a signed-out run. Desktop-only integrations: `pnpm tauri dev` with HOME and CFFIXED_USER_HOME on a scratch dir (plus real CARGO_HOME, RUSTUP_HOME), seed settings.json + Readest/Books/library.json + <hash>/config.json, and stop any `pnpm dev-web` on 3000 first: a web dev server makes the Tauri window run as the web platform (demo books, seeded library ignored). A vault under a folder named `Readest` is in fs scope without the picker. Use `curl --noproxy '*'` for :4445. The webview's localStorage is NOT isolated by the fake HOME, so remove `readest-data-flow` afterwards. Android: `tauri android build -t aarch64 -- --features devtools` installs over the owner's phone (368b0948, Xiaomi 13) keeping data; drive with CDP plus real adb taps. Node's WebSocket connects without an Origin header. Clear http_proxy first. Unfixed and out of that PR: native multipart `download_file` swallows failed parts and returns Ok, so a partial book counts as downloaded (`src-tauri/src/transfer_file.rs`); a moved Obsidian vault folder is recreated at the old path with a new note. Known count limits: BookOrbit re-sends pulled notes, so they count once as sent; progress sent grows by 1 per book open. Check `topResumedActivity` before installing on the owner's phone: the 2026-11-06 install interrupted them mid-use. Related: [[xcfi-astral-offsets-nonlinear-spine]], [[feedback-pin-adb-serial]].
