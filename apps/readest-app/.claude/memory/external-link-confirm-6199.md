---
name: external-link-confirm-6199
description: "#6199 confirmation before following external links: foliate's cancelable external-link event, footnote popups need forwarding, Alert tests need an EnvContext mock"
metadata: 
  node_type: memory
  type: project
  originSessionId: db2395db-b451-45b7-8459-b0e489b0887b
  modified: 2026-09-18T02:58:37.001Z
---

#6199 (tap on a web link throws the reader out to the browser) — MERGED #6254 (70d964758) on 2026-09-18, UNRELEASED. Chrome-verified on the web build only; the Tauri opener-plugin path was never tested, and no setting/"ignore taps entirely" option was built (the issue also asked for that).

- foliate `view.js#handleLinks` emits a **cancelable** `external-link` event and opens the link itself unless it's prevented. Nothing in readest listened, so the fix is a listener, not an interception of `window.open`. `src/app/reader/components/ExternalLinkConfirm.tsx` preventDefaults, stores the href, shows `Alert` + `ModalPortal`, and calls `openExternalUrl` only on confirm.
- **FootnotePopup renders its own foliate view**, so its links never reach the main view's listener. It forwards them: preventDefault, then re-dispatch `external-link` on `getView(bookKey)`. Same trap applies to any future view-level event handler — the popup view is a second, independent `foliate-view` element. See [[footnote-popup-double-scrollbar-5999-5998]].
- Any test rendering `Alert` must mock `@/context/EnvContext` — `Alert` → `useKeyDownActions` → `useEnv`, which throws "must be used within EnvProvider" outside a provider.
- **Verification recipe without importing a book** (the dev library is chrox's real signed-in account, 700+ books; importing a test EPUB risks syncing it): open any book, then in the section document inject `<a href="https://…">` and call `a.click()` — the click listener lives on the section doc, so this is the real path. Stub `window.open` to push to an array instead of opening; reload the tab afterwards to restore it. For the popup path, click a real noteref (Moby-Dick section 3 has `#n1`), then inject the link into the popup view's doc (`[...document.querySelectorAll('foliate-view')].find(x => x !== main)`).
- `pnpm test -- <file>` ignores the path and runs the whole suite (~2.5 min). Single file: `npx dotenv -e .env -e .env.test.local -- vitest run <file>` — bare `npx vitest` dies in `src/utils/supabase.ts` on an `atob` of a missing env var.
