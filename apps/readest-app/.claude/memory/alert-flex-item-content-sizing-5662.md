---
name: alert-flex-item-content-sizing-5662
description: "PR #5662 - Alert sized itself off its own text because its wrapper was a flex item with no definite width; w-full on the wrapper is load-bearing, and browser tests are the only way to assert layout"
metadata: 
  node_type: memory
  type: project
  modified: 2026-08-13T05:48:14.339Z
  originSessionId: c4d679f5-5385-4d06-a419-773592fb8e24
---

`src/components/Alert.tsx` — PR #5662 MERGED 2026-08-13 (merge commit `561356628`).

**The trap:** `Alert`'s outer wrapper had `flex justify-center px-4` with **no width**, and every
call site mounts it as the lone child of a `fixed inset-x-0 flex justify-center` bar
(Bookshelf, BookDetailModal, StorageManager, ClipSignInAlert, ReceiveRequestDialog) or
`ModalPortal` (`flex items-center justify-center`). A flex item with `width: auto` sizes to its
**content**, so the inner box's `w-full max-w-md sm:max-w-lg md:max-w-xl` resolved against a
shrink-to-fit parent — the surface measured itself off its own longest line. A child's
`max-width` only clamps the parent's max-content contribution; it never makes the width definite.

Result: no two alerts in the app were the same width, and any alert whose text changed while
open resized mid-dialog. `DeleteConfirmAlert`'s purge toggle made it visible (swaps in longer
copy AND a longer button label). Measured at a 1024px viewport: delete alert 395.7px -> 576px on
toggle; a plain alert was 192.7px with a short message and 571.8px with a long one.

**Fix = `w-full` on the wrapper** (`z-[130] flex w-full justify-center px-4`). One class. The
comment there is load-bearing — without it this reads as redundant and will get "cleaned up".

**The rejected fix** (the PR as submitted) wrapped `DeleteConfirmAlert` in `<div className='w-full
max-w-md'>`: +41/-39 lines, pinned only that one component while every other alert kept jittering,
and its `max-w-md` overrode the shared `sm:max-w-lg md:max-w-xl` so the delete dialog rendered
160px narrower than every other alert on desktop. Fixing the shared component was 1 line and
fixed all five call sites.

**Asserting layout needs a browser test.** jsdom has no layout engine, so
`getBoundingClientRect()` is all zeros — a jsdom test here can only mirror class strings
(see [[feedback-no-config-mirror-tests]]). `src/__tests__/components/alert-width-stability.browser.test.tsx`
runs under `pnpm test:browser` (real Chromium + real Tailwind via `await import('@/styles/globals.css')`,
pattern copied from `popup-theme-surface.browser.test.tsx`) and measures real widths. It asserts
three things: no jump across the toggle, the delete alert matches a plain alert, and a plain alert
doesn't size off its message.

**Screenshotting from a browser test:** `page.screenshot({path})` is subject to Vite `server.fs`
— an absolute path outside the project root fails with "Access denied", `/tmp` included. Write
inside the worktree and delete afterwards. Fastest way to eyeball a shared component across
states without booting `pnpm dev-web` or importing a book; see [[browser-verify-readest-web-recipe]]
for the full-app route.

Delivered as a fast-forward onto the contributor's tip per [[ci-pr-delivery-and-push]].
