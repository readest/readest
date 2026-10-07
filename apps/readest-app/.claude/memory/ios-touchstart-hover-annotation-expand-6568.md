---
name: ios-touchstart-hover-annotation-expand-6568
description: "#6568 iOS annotation cards expanded on every scroll touch; iOS WebKit sets :hover at touchstart of a scroll drag; fix = drop group-hover reveal on iOS, keep focus-within"
metadata:
  node_type: memory
  type: project
  originSessionId: 3b0e2e53-6f48-4883-8678-48977404370d
  modified: 2026-10-02T17:06:42.926Z
---

#6568 (iPadOS 16): scrolling the sidebar annotation list expanded the card under the finger on every touch (lag from max-height reflow, accidental Delete taps).

Sim-verified on iOS 16.4 Safari with a scratch page: a plain scroll drag logs `touchstart N` then `:hover` on card N at once, with no mouseover, focus or click. A tap goes touchstart → touchend → mouseover → focus → click, so `:focus-within` still expands on a deliberate tap. Android Chrome applies hover only on tap or long-press, which is why Android felt fine. `globals.css` overrides Tailwind 4's `@media (hover: hover)` gate (`@custom-variant hover (&:hover)`), so `group-hover:` fires on touch.

Fix (MERGED #6571 as a0a617ceb, 2026-10-03, UNRELEASED): `BooknoteItem.tsx` drops the `group-hover:` reveal classes when `appService.isIOSApp`, and a 300ms long press (`useLongPress`) focuses the card and swallows the click iOS sends afterwards. Focus alone was NOT enough (chrox asked "how can we expand the items"): on iOS 18 a long press still dispatches click, which navigates and closes an unpinned sidebar. Tests in `BooknoteItem.test.tsx`. Verified in the real app on the iPad Air 11 (M3, iOS 18.5) simulator, pinned and overlay: scrolling never expands, a long press reveals actions without navigating, Delete works, a tap navigates.

Sim recipe: import via Files after patching `UIFileSharingEnabled`. Seed annotations by writing `booknotes` into `Library/Application Support/com.bilingify.readest/Readest/Books/<hash>/config.json` and relaunching. Generate real CFIs from the unzipped EPUB with jsdom. The shared `target` needed the [[swift-rs-module-cache-shared-target-worktrees]] ModuleCache wipe. Bare `dotenv` resolves to a Ruby gem, so use `pnpm exec dotenv`.

**Why:** Any `group-hover:` layout change in a scrolling list will fire on iOS scroll touches.
**How to apply:** On iOS, reveal list-row actions on a long press that focuses the row, not on hover. Related trap: `pnpm lint` tsc showed a phantom foliate-js export error from a stale incremental cache. `npx tsc --noEmit --incremental false` was clean.
