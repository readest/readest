---
name: kavita-kosync-zero-based-percentage-7503
description: "Kavita's KOSync endpoint sends percentage (page-1)/total with device \"Kavita\" and its own hashed device_id; how Readest reads it (#7503, PR #7513 MERGED 9f20bea82)"
metadata:
  node_type: memory
  type: project
  originSessionId: d8097bd2-e666-4587-b01a-be8979736504
  modified: 2026-11-17T05:17:24.436Z
---

Kavita's KOReader-compatible sync (`KoreaderBookDtoBuilder` in Kareadita/Kavita) answers a PDF position with `progress` = 1-based page string, `percentage = pageNum / pages` where pageNum is Kavita's 0-based page, i.e. (page-1)/total, `device: "Kavita"` always, and `device_id` = SHA-256(installId + userId) — never Readest's id, so Kavita reports never hit the same-device branch in `useKOSync`.

PR #7513 (merged 2026-11-17 as 9f20bea82) fixed "page 2 of 22" for an 11-page PDF:
- `getRemoteTotalPages(page, pct, localTotal, mayBeZeroBased)` in `kosyncProgress.ts`; zero-based reading only when `remote.device === 'Kavita'` AND within ±1 of local total AND closer than page/pct. KOReader's page 2 of 22 has Kavita's numbers for page 2 of 11, so the device gate is required.
- Fixed-layout conflict: page equality suppresses a conflict only when remote total === local total exactly; otherwise compare percentages. `pagesMatch` (±1) only picks "Page" vs "Approximately page" wording (main's rule, left alone).

**Why:** two CodeRabbit passes found the heuristic-only and ±1 versions each hid real conflicts.
**How to apply:** for any future KOSync server quirk, gate on what the server identifies itself as plus a consistency check, and reproduce with the dev-web mock ([[kosync-dev-web-mock-server-recipe]]) using the server's exact response shape.

Also learned: don't wrap `git push` in a short `timeout` — the pre-push hook runs the unit suite (>2 min) and the kill makes the push silently not land; verify the PR head after pushing.
