---
name: slider-rtl-logical-properties-6157
description: "#6157 reader sliders ran against the drag in RTL books; fix = logical properties, not JS direction resolution. Native range inputs mirror themselves; jsdom cannot see mirroring."
metadata: 
  node_type: memory
  type: project
  originSessionId: 365976d8-f6ae-4def-92a7-42ca7a5d96ec
  modified: 2026-09-16T14:43:59.078Z
---

**#6157 — sliders in the text options panel moved against the drag in RTL
books.** MERGED as PR #6168, merge commit `ca79bc3d9` (2026-09-16), on top of
@jadhavgaurav's `44bf50436`. Not device-verified with a real Arabic EPUB.

**A native `<input type="range">` mirrors itself from the inherited direction.**
Measured in Chromium: from 50, `ArrowLeft` gives **49** under `dir='ltr'` and
**51** under `dir='rtl'`. This holds with `-webkit-appearance: none`
(`globals.css` sets it on `.slider-input`). Any custom visuals drawn over such an
input must mirror from the *same* source or they fight it.

**The footer bar's `dir` flips AFTER mount — and not for the reason it looks
like.** `FooterBar.tsx` renders `dir={viewSettings?.rtl ? 'rtl' : 'ltr'}`, but
`viewSettings` is **never undefined** there: `BooksGrid.tsx` (`BookCellInner`)
returns `null` until it exists. The real trigger is `FoliateViewer.tsx` (~line
375), which derives `rtl` from the first document's writing direction on the
`load` event and writes it back via `setViewSettings`. The panels hosting the
sliders are always mounted (only translated out of view), so anything that reads
direction once on mount is already stale. Also note `viewSettings.rtl` is book
direction **OR** `getDirFromUILanguage() === 'rtl'`.

**Fix: let CSS do it.** `inset-inline-start` on the fill and thumb, so the
browser mirrors them from the same inherited direction the input reads. Deleted
the `isRtl` state, the ref, the ancestor `dir` walk and the component's own
`dir` attribute (net −11 lines). `transform: translateX(-50%)` has **no logical
form** — center the thumb with a negative `margin-inline-start` instead (the
bubble is exactly `heightPx` wide, so they are equivalent).

Re-running the ancestor walk on every render (the original PR) also works, but
only when the slider itself re-renders. The CSS version needs no render at all —
verified live by flipping the footer's `dir` in the DOM with React idle: all four
real sliders mirrored instantly, thumb 81.8px from the left becoming 81.8px from
the right.

**jsdom cannot verify RTL mirroring — it has no layout.** Assertions on the
inline `left`/`right` only read back what the component just wrote, so they pass
for a broken mirror and *block* the logical-property fix. Direction coverage
belongs in `*.browser.test.tsx`, measuring `getBoundingClientRect`. The useful
shape: report distances from whichever edge is the start
(`dir === 'rtl' ? track.right - box.right : box.left - track.left`) so LTR and
RTL yield the same numbers, then assert the thumb is genuinely on the other half
so equality cannot pass by accident. Keep a jsdom guard that no inline style
names `left`/`right`. Mount-time mirroring passed on main — only the **post-mount
flip** and **ArrowLeft-under-RTL** cases actually reproduce the bug.

**Chrome MCP cannot cross a Tailwind breakpoint.** The tab renders offscreen:
`innerWidth` pinned at 1280, `outerWidth` 0, and `resize_window` does not move
it, so `sm:`-hidden mobile panels stay `display:none`. `!important` inline styles
did not reposition them either. For screenshots of a component, use the repo's
vitest browser lane instead — `page.screenshot({ path, element })` with an
**absolute** path (a relative one is silently dropped by Vite's `server.fs`
check). See [[adhoc-visual-check-daisyui-theme-tokens]].

Fork-PR push went in as a plain fast-forward using the plumbing recipe in
[[worktree-new-rebases-pr-force-push]] — the PR branched off the exact commit the
working tree sat on, so there was no base drift. Related:
[[eink-class-substring-matchers]].
