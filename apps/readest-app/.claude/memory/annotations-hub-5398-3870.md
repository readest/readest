---
name: annotations-hub-5398-3870
description: Centralized annotations hub (sidebar tab = per-book hub) MERGED #5448 (squash be5f07ef, 2026-08-03); closes #5398 #3870; worktree and branches cleaned up
metadata: 
  node_type: memory
  type: project
  originSessionId: 138d91ff-f7d6-465b-8a89-35b703957a3c
  modified: 2026-08-02T16:31:06.580Z
---

Issues #5398 + #3870 (duplicates, solved together): sidebar Annotations tab became the per-book hub. **MERGED as #5448** (squash be5f07ef on main, 2026-08-03); e2e fix included (annotation.spec asserts notes in the hub, closeNotebook page-object helper for the capture overlay). Worktree + both feature branches removed; dev reset onto the squash. Old dev WIP still parked in stash ('pre-annotations-hub cherry-pick: dev WIP'). Follow-ups landed on dev after cherry-pick: header search icon drives annotation search per-tab (in-book search on other tabs; tab switch closes either), notebook reduced to editor+excerpts ('Search excerpts...' key in 33 locales), filter dropdown panel (funnel fills bg-base-300 only while active), popup dismissal on relocate (CFI-change-guarded vs settle events) + on sidebar open (popup z-50 vs sheet z-45), tab scroller overflow-x hidden (touch-target halo overflow).

Key decisions (spec: docs/superpowers/specs/2026-08-02-centralized-annotations-design.md, local-only):
- One-click nav: BooknoteItem click no longer opens Notebook; Notebook keeps its list (maintainer choice).
- Inline note edit incl. Add Note on bare highlights; `decideNoteBubbleTransition`/`applyNoteBubbleTransition` reconcile the NOTE_PREFIX bubble; whitespace-only drafts normalize to '' (phantom-note guard).
- `filterBooknotes(notes, {kind, query, excludedColors?, excludedStyles?})` + `collectAnnotationFacets` in annotatorUtil are shared by hub, Notebook SearchBar, and (facets) filterExportGroups.
- Toolbar redesigned mid-build per maintainer (WeRead ref): icon row [search][funnel][3-dot]; tap-to-reveal search (close clears query); filter dropdown panel with kind chips + A-glyph style toggles + color dots + Reset + badge dot; panel must merge Dropdown-injected `menuClassName` (`no-triangle mt-1`) or the legacy triangle notch renders.
- Nearest-scroll effect: suppressed while filtering AND `lastScrolledCfiRef.current = null` in that branch, else clearing a filter strands the list (fix round 1).
- BooknoteView height now measured from `listHostRef` (toolbar sits above it).

PR-body notes owed: zh locale terminology drift (笔记/注释 vs 标注) needs maintainer pass; BooknotesNav now browses the filtered subset; trimmed-query widens Notebook search matches; inline save preserves `note.page` (Notebook's handleEditNote overwrites it - asymmetry left intentional). Follow-up minors: no Escape-close on filter panel; no-op inline save still bumps updatedAt.

Related: [[mobile-sheet-virtuoso-first-paint-blank]], [[turbopack-dev-stale-chunk-phantom]]
