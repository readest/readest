---
name: toc-multiline-headings-5852
description: "#5852 TOC sidebar truncated long headings to one line; now wraps fully. MERGED #5858, reporter verify pending"
metadata:
  type: project
  originSessionId: dd1311e7-96b6-47f2-a84b-e87d18775518
  modified: 2026-08-24T19:14:34.532Z
---

Issue #5852 (2026-08-24, chchen2021): TOC entries showed one line and cut long English section headings off with an ellipsis; reporter used BookFusion just to read the TOC. PR #5858 opened and MERGED 2026-08-25 (`6ccdf8fb7`); worktree and local branch removed.

Fix = one-liner in `TOCItemView` (`src/app/reader/components/sidebar/TOCItem.tsx`): label `ms-2 min-w-0 break-words` (was `truncate` + inline `nowrap` + `maxWidth: calc(100% - 24px)`), page number `shrink-0`. No clamp: full wrap, per the issue. Rows were already `height: auto` under Virtuoso, so nothing in `TOCView` changed and the auto-scroll/`buildTOCDisplayItems` index invariants ([[toc-current-position-row]]) are untouched.

Decisions worth remembering:
- Kept `items-center` (chevron + page number centered on tall rows) because `SettingsRow`-style rows in DESIGN.md center trailing content next to multi-line leading text. First-line alignment would need the page number's `text-xs` line-height to match the label's (`leading-[inherit]` works on Tailwind v3 since `text-sm/base` set rem line-heights) - only do it if the maintainer asks.
- `min-w-0` is the load-bearing class: `overflow-wrap: break-word` does NOT shrink a flex item's min-content, so without it an unbreakable token pushes the page number out of the row.
- `.translation-target-toc` (`src/utils/style.ts`) only adds `overflow: hidden; text-overflow: ellipsis` and inherited the nowrap, so translated headings wrap along; left as is.
- `CurrentPositionRow` label still truncates (fixed short i18n string).

Test: `src/__tests__/components/toc-item-wrap.browser.test.tsx` (Chromium, real Tailwind via `globals.css`, 300px tree). jsdom can't assert wrapping; CI runs `pnpm test:browser` in `pull-request.yml`.

Verify recipe (web): `pnpm dev-web -p 3457` in the worktree, drop a `public/*.epub` copy into the library with a synthetic `DragEvent('drop')` carrying a `DataTransfer` file on `.library-page` (web has no `<input type=file>`; `selectFiles` throws in the browser). Chrome MCP `resize_window` bottoms out at ~555px viewport on this Mac, still < 640 so the mobile sheet renders. A test book "Long TOC Headings" was left in the localhost:3457 dev library.

Status: reporter/device verify pending.
