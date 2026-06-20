---
name: series-folder-back-noop-4437
metadata: 
  node_type: memory
  type: project
  originSessionId: a2672a28-3bd3-4c6a-a595-f4d40d63ab50
---

# Cannot navigate back from series/author folder (#4437)

**Symptom:** Inside a Series/Author library folder, the back arrow does nothing. Cross-platform (Android/iOS/Windows), onset v0.10.1, worse with large libraries; maintainer couldn't reproduce.

**Root cause:** Next.js 16.2 **static-export** regression — `router.replace()` to a same-pathname URL with an **empty query string** silently no-ops (`output:'export'`, i.e. every non-web build; `next dev` does NOT reproduce it). Same root cause as #3782, fixed for the breadcrumb "All" button in **#3832** by setting `group=''` instead of deleting it (→ `/library?group=` commits; a cleanup effect in `page.tsx` strips the trailing `group=` via `history.replaceState`). `GroupHeader.handleBack` (series/author back arrow, added in #3146) was never given that workaround — it did `params.delete('group')`.

**Why `group` is the only param (and why maintainer couldn't repro):** `groupBy` resolves URL-first, settings-second (`Bookshelf.tsx:166`). Picking Series/Author from the View menu writes it to settings AND puts `groupBy=author` in the URL, so *in-session* `delete('group')` leaves `?groupBy=author` (non-empty) → back works. But after a **cold start** the URL is clean `/library` (groupBy from settings); tapping a folder gives `?group=X` as the ONLY param → delete → empty → no-op. Needs default sort/order/view too (else those keep the query non-empty) — hence chrox's instinct to ask about the Sort config.

**Fix:** `GroupHeader.tsx` `handleBack` → `params.set('group','')` (mirror `handleLibraryNavigation`). Test: `src/__tests__/app/library/group-header.test.tsx` asserts the back nav keeps a non-empty query (`group=`).

**Verification gotcha (CDP on device):** synthetic `el.click()` does NOT fire React's `onClick` in the WebView → false "no-op". Use a **trusted** `Input.dispatchMouseEvent` at the element's `getBoundingClientRect` center. Verified on Xiaomi (WebView 148, built with `pnpm dev-android`): trusted back-click took `?group=9497393` → `/library`, folders restored. See [[android-cdp-e2e-lane]].
