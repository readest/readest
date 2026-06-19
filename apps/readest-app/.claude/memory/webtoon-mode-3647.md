---
name: webtoon-mode-3647
description: "Webtoon Mode (#3647) — seamless no-gap scrolled reading for image books; fixed-layout scroll-mode facts + submodule PR flow"
metadata: 
  node_type: memory
  type: project
  originSessionId: 4df24b79-87bd-4089-be36-fe30a0ba0a77
---

Webtoon Mode (#3647): toggle for image books (CBZ/manga/PDF/fixed-layout EPUB) = scrolled flow + 0 page gap + fit-width. PRs open (not merged): **readest/readest#4662** + **readest/foliate-js#30** (submodule). Branched from origin/main at 1faa931a0.

**Key architecture fact (non-obvious):** the foliate-js **fixed-layout scrolled renderer is fit-width by construction** — `#renderScrollMode` scales each page `hostWidth/vpWidth * scaleFactor`; it **ignores the `zoom` attribute** (fit-page/fit-width only matter in paginated/fxl non-scroll). So in scroll mode the ONLY thing that breaks fit-width is `scale-factor ≠ 100` (i.e. `zoomLevel ≠ 100`). Webtoon Mode forces `zoomLevel=100`. The 4px inter-page gap was the hardcoded `margin: 4px 0` on `.scroll-page` (`packages/foliate-js/fixed-layout.js`).

**Implementation:** new `scroll-gap` observed attribute → host `--scroll-page-gap` var → `.scroll-page { margin: var(--scroll-page-gap, 4px) 0 }` (backward-compat default; capture/restore scroll anchor in the handler so toggling doesn't jump). Pure exports `scrollGapToCss` (foliate) + `getScrollGapAttr` (`src/utils/webtoon.ts`, `true→'0'`/`false→'4'`). Boolean `webtoonMode` in `BookLayout` (global+per-book, `skipGlobal=false`). ViewMenu toggle in the `pre-paginated` block reuses the existing `scrolled`+`zoomLevel` effects. **Leaving scrolled clears webtoonMode in TWO places:** the ViewMenu `isScrolledMode` effect AND `useBookShortcuts.ts toggleScrollMode` (Shift+J — the final review caught this; ControlPanel scrolled toggle is `disabled` for fixed-layout). Host CSS custom props inherit across the shadow boundary (cf. `--scroll-bg-color` set on `:root` in globals.css). See [[edge-tts-word-highlighting-4017]] for the overlay-in-shadow-root pattern.

**Submodule PR-flow gotcha:** `pnpm worktree:new` sets the worktree's foliate-js submodule `origin` to a **local path** (`.git/modules/...`), and the submodule is at **detached HEAD**. To publish a foliate-js commit you must push the SHA directly to the GitHub fork: `git push git@github.com:readest/foliate-js.git HEAD:refs/heads/<branch>`, then `gh pr create --repo readest/foliate-js`. The fork uses a PR flow (#28/#29/#30), so do a **separate foliate-js PR first**; the readest pointer resolves by SHA once the commit is on the fork (even pre-merge). If the foliate PR squash-merges (new SHA), re-bump the readest pointer.
