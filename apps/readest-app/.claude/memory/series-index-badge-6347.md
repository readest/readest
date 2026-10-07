---
name: series-index-badge-6347
description: "#6347 grid series info reworked (chrox) into a \"#N\" cover badge shown only inside an opened series group; PR #6579 contributor branch"
metadata:
  node_type: memory
  type: project
  originSessionId: 460d5e28-4199-488b-9ef1-dbccdcca69fc
  modified: 2026-10-04T13:45:19.322Z
---

#6347 asked for series title + number on grid cards. chrox rejected adding a series row to the grid (no spare room) and asked for a series-index badge at the top-right of the cover, shown **only inside an opened series group**, where the breadcrumb already names the series.

Rework pushed 2026-10-04 to contributor PR #6579 (kelvinalfaro/feat/grid-series, maintainerCanModify) as b885b307c on top of a merge of main (fast-forward, no force push); CodeRabbit a11y fix 801712ff5 (card aria-label "Title #N", BookshelfItem resolves the index and passes `seriesIndex` to BookItem). All CI green; MERGED 2026-10-04 as a05dcae6d, UNRELEASED; worktree removed.

- Gate: `showSeriesIndex = !!groupId && !queryTerm && groupBy === Series` in `Bookshelf.tsx`, passed through BookshelfItem to BookItem. Grid only; list rows keep their "Series #N" line.
- Badge: `eink-bordered bg-base-100/90 absolute end-1 top-1`, uses `getSeriesIndex` (so no badge for 0/NaN/missing).
- Verified in web dev (port 3001) on the existing Академия series group.

**How to apply:** follow-up asks for series info in grid view should build on the badge, not a text row. [[worktree-new-rebases-pr-force-push]] applied here: reset to the real head, then merge main.
