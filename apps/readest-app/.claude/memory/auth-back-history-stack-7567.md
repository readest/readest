---
name: auth-back-history-stack-7567
description: "#7567 login page reopened by Android back: /auth left on history; PR #7568 (community) MERGED 35bc7decc; /user→/auth must replace; account-page sibling unfixed"
metadata:
  node_type: memory
  type: project
  originSessionId: aab36895-1582-46e2-b3df-aa85e2f79441
  modified: 2026-11-17T16:10:16.349Z
---

#7567 (doublex640, Android 0.12.20): leaving `/auth` with `router.push(redirect)` left
`/auth` on the stack; the reader's Android back (`close-reader` → `router.back()`) landed on it.

PR #7568 (contributor's branch, maintainerCanModify) — my rework 63b6811f1, merged main ff7e6ef36, MERGED 35bc7decc 2026-11-18, worktree removed:
- Auth exits: `router.back()` when `useReaderStore` viewStates non-empty, else `router.replace(redirect ?? '/library')`. Static import; the contributor's dynamic import only dodged partial `@/services/environment` mocks (fix = mock `@/store/readerStore` in auth tests).
- **Trap:** signed-out `/user` hands off to `/auth` after 1 s. It pushed, so `back()` from `/auth` hit `/user` → `/auth` again (back arrow could never reach the book). Now `router.replace`. Path to hit it: reader → Settings → Integrations → WebDAV (premium row → `navigateToProfile` even when signed out).
- Unfixed sibling: `navigateBackFromProfile` (#6607) still `replace`s back to the reader, leaving an older `/reader` entry. `back()` would drop the #6607 slide transition (transition router wraps only push/replace), so it's a maintainer call.
- Verified via temp Playwright spec on dev-web :3007 (Integrations → Readest Cloud / WebDAV, back arrow, `page.goBack()`); no Android device attached, not device-verified.
- `auth-page-duo.browser.test.tsx` aborts ~1/3 runs with `route.fulfill: Route is already handled!` on main too; reopened #7216.

Related: [[plans-page-back-to-reader-6607]], [[feedback-pr-review-no-posting-offer]].
