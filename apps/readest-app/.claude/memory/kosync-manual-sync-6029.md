---
name: kosync-manual-sync-6029
description: "#6029 manual sync — BookOrbit ONLY (chrox rescope), autoSync on the engine config, provider-addressed events, IndexedDB browser-verify recipe"
metadata:
  type: project
---

#6029 asked for two things; only the **manual-sync half** was built (chrox: "Support manual sync just like Hardcover").
The progress-increment throttling / sync-on-close half is UNIMPLEMENTED. MERGED 2026-09-03 as 9e316c7d7 (PR #6034,
squashed); branch and worktree cleaned up. Not verified against a live BookOrbit server.

**SCOPE — BookOrbit only.** The first cut gave the Auto Sync toggle to both KOSync-protocol backends; chrox: *"Don't
touch kosync, only add manual sync for BookOrbit"*. KOReader Sync keeps its always-automatic pushes and `KOSyncForm.tsx`
is untouched. **Why:** KOReader Sync mirrors KOReader's own behaviour and users expect it to match; BookOrbit is the one
whose server keeps a per-push reading log the user was complaining about. **How to apply:** when a change would land on
both instances of `useKOSync`, ask which backend actually has the problem before generalizing.

**Design**
- `autoSync?: boolean` is on `BookOrbitSettings` (persisted, default **ON**) and on `KosyncEngineConfig` — a
  `KOSyncSettings & { autoSync? }` alias that `provider.selectConfig()` returns. Keeping it OFF `KOSyncSettings` is what
  leaves the persisted KOReader Sync shape untouched while the shared hook can still read the flag.
- Default ON (`autoSync !== false`), unlike Hardcover's default-OFF, because auto-push is the pre-existing behaviour and
  must not change silently. Settings written before the flag have no key; `undefined` reads as ON everywhere.
  `loadSettings()` spreads stored settings over defaults at the TOP level only, so `settings.bookorbit` comes back whole
  from disk — no per-section deep merge to rely on.
- The gate lives in the CALLERS of the debounced `pushProgress` (the auto-push effect + the window-deactivate
  `push(); flush()` pair), never inside `pushProgress` — so explicit `push-kosync` still works. Same shape as
  `useHardcoverSync`.
- **Pulls stay automatic** with Auto Sync off. The complaint is server-side reading-log clutter, which only pushes cause;
  pulls also keep the `hasPulledOnce` guard that prevents #5065-style clobbering.

**Three latent bugs found on the way**
1. `push-kosync` / `pull-kosync` were answered by BOTH instances of `useKOSync` (kosync + bookorbit share the hook and the
   event names). Fix = optional `detail.provider`; an event without one still broadcasts.
2. BookOrbit had **no** book-menu entries at all, so manual sync was unreachable — added a "BookOrbit Sync" submenu
   (new i18n key, derived per locale from each locale's existing "Hardcover Sync").
3. ViewMenu's Sync row dispatched `flush-kosync`, and `debounce().flush()` is a NO-OP when nothing is pending — in manual
   mode the row would do nothing. It now dispatches `flush-kosync` (unchanged, for KOSync) PLUS a
   `push-kosync` addressed to `'bookorbit'`.

**Browser-verify recipe (web app has no KOSync server)**
- Settings live in the `AppFileSystem` IndexedDB, store `files`, key `Settings/settings.json`, record `{path, content}`
  where content is a JSON string. Patch `kosync`/`bookorbit` with `username`/`userkey`/`enabled:true` and
  `serverUrl:'http://127.0.0.1:9/'` (discard port — every request dies at CORS preflight, nothing leaves the machine)
  to make `isConfigured` true and reveal the forms.
- Tell the two providers apart by ENDPOINT PATH: kosync hits `/syncs/progress`, BookOrbit hits
  `/api/v1/koreader/syncs/progress`. That is how provider addressing was confirmed live.
- **The app flushes its in-memory settings back over the file**, so restoring from inside the running app is not durable.
  Restore from a same-origin page that does NOT boot the app — `http://localhost:3000/runtime-config.js` works.
- Auto-push CANNOT be exercised this way: the pull-on-open fails at preflight, `hasPulledOnce` never flips, and the
  auto-pusher stays gated. That half is unit-test-only (`src/__tests__/hooks/useKOSync.test.tsx`).

Rebasing onto main conflicts in all 34 locale files — both sides append keys at the tail of the JSON object, so the
resolution is always a union: keep upstream's lines, comma, then yours.

See [[reader-menu-third-party-sync-status-5910]], [[custom-headers-kosync-bookorbit-5570]],
[[verify-dev-web-serwist-stale-locales]].
