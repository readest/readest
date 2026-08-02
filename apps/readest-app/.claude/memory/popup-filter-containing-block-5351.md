---
name: popup-filter-containing-block-5351
description: "PR #5351 popup restyle: a not-eink:drop-shadow-xl wrapper around Popup re-anchored the absolutely positioned popup off its viewport coords AND demoted its z-50 under later reader chrome, because a non-none filter creates a containing block + stacking context"
metadata: 
  node_type: memory
  type: project
  originSessionId: c6e61903-3da9-4c41-9d2d-3e2df4baa0a2
  modified: 2026-08-02T18:47:27.186Z
---

2026-08-03, found reviewing PR #5351 "restyle popups" (fixed, pushed to the contributor fork, MERGED as e05b7d5bb). The PR wrapped `Popup`'s output in `<div className='not-eink:drop-shadow-xl'>` so the shadow would wrap the pointer triangle too.

**Mechanism:** a `filter` other than `none` makes the element a containing block for `position: absolute`/`fixed` descendants AND a stacking context. `Popup` is handed OUTER-webview viewport coordinates and pins itself `absolute` + `z-50`. So the wrapper (1) re-anchored the popup to the wrapper's static flow position instead of the viewport/nearest positioned ancestor, and (2) scoped `z-50` inside a wrapper that is itself an in-flow non-positioned block — painted well before positioned siblings, so `FooterBar` / `BooknotesNav` / `SearchResultsNav` / `FootnotePopup` (all rendered AFTER `<Annotator>` in `BooksGrid`) could paint over the popup. Being `not-eink:`, e-ink and normal themes got different layout semantics. Fix: no filter on the wrapper; put `not-eink:drop-shadow-xl` on `.popup-triangle-outer` itself (it is already `absolute z-50`, so a filter there is harmless).

**How to apply:** never put `filter`/`drop-shadow`/`opacity<1` on an ancestor of an element that positions itself in viewport coordinates. Prove it with a real layout engine — jsdom cannot: `src/__tests__/components/popup-ancestor-filter.browser.test.tsx` (passes on main, failed on the PR). Also from this review: `triangleHidden` swapped z-index demotion for `invisible`, which silently defanged #5431's guard ([[popup-triangle-borderbox-eink]]) since it only asserted `z-50`/not-`z-10` — assert visibility too. `text-foreground` maps to an undefined `var(--foreground)` (tailwind.config.ts) and silently resolves to `inherit`; use `text-base-content`. Added a `theme-dark:` variant (`html[data-theme$="-dark"] &`) because Tailwind's built-in `dark:` follows prefers-color-scheme and never matches this app's `data-theme` scheme. Screenshot blocker: [[vitest-screenshot-baseline-relative-path]]
