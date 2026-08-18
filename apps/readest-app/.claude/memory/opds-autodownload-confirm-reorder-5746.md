---
name: opds-autodownload-confirm-reorder-5746
description: "#5746 OPDS auto-download confirm dialog + drag-to-reorder; CatalogManager's sorted display order was dead code before this"
metadata: 
  node_type: memory
  type: project
  originSessionId: 542d514e-6956-4262-987d-66a9d96afc34
  modified: 2026-08-17T08:52:07.291Z
---

Issue #5746 asked to REMOVE the Auto-download toggle from the OPDS catalog list
(easy to mis-tap while scrolling, especially on e-ink; enabling starts
downloading the whole catalog). User chose the alternative instead: keep the
toggle, gate it behind a confirmation, and add drag-to-reorder.
MERGED #5760 on 2026-08-17 as `f7f8a830d`. Worktree and branch cleaned up.

**One component serves both reported surfaces.** Settings > Integrations
(`IntegrationsPanel`) and Import Books > Online Library (`OPDSDialog`) both
render `app/opds/components/CatalogManager.tsx`. Fix it once.

**The load-bearing discovery: `getAvailableCatalogs()`'s sort was dead code.**
`CatalogManager` seeded local state from it in `useState`, but the store is
empty at first render (`loadCustomOPDSCatalogs` runs in an effect), and the
effect that follows did `setCatalogs(allCatalogs.filter(c => !c.deletedAt))` —
raw store order, unsorted. So the documented "newest first" contract never
applied; the live order was the persisted settings array order. Drag-to-reorder
can't work against an order the store and component disagree on, so the effect
now goes through `getAvailableCatalogs()`. Costs existing users a ONE-TIME
reshuffle to newest-first; any drag pins the order permanently after that.

**Ordering model:** new `sortOrder?: number` on `OPDSCatalog`. `compareForDisplay`
puts `sortOrder`-bearing entries in ascending order and sorts never-dragged ones
(comparing `addedAt` desc) ABOVE them — so a freshly added catalog still lands on
top of a hand-arranged list. `reorderCatalogs(orderedIds)` stamps 0..n-1 across
the WHOLE visible set (given ids lead, omitted ones trail in prior order) so no
entry is left unstamped and flung back to the top. One replica upsert per changed
row. Field added to the adapter (pack/unpack/unpackRow) + `opdsCatalogFieldsSchema`.

**dnd-kit gotchas here (differs from `CustomDictionaries.tsx`, the precedent):**
- Use `rectSortingStrategy`, not `verticalListSortingStrategy` — the catalog list
  is `grid-cols-1 sm:grid-cols-2`.
- Do NOT put `touch-target` on the drag handle. That class inflates the hit area
  to 44px via a `::before`, which on this card bleeds an invisible dead zone over
  the catalog name; the card is itself the browse click target, so taps there
  would silently do nothing. Size the handle `h-7 w-7` to match the 3-dot trigger.
- stopPropagation must go on a WRAPPER div, never on the handle button — a React
  `onKeyDown` on the button replaces dnd-kit's own from `{...listeners}` and kills
  keyboard dragging.
- `useSortable` is a hook, so the card had to be extracted out of the `.map()`
  into a `CatalogCard` component.

**Testing:** jsdom can't simulate a dnd-kit drag, so reorder logic lives in the
store and is unit-tested there; the component test only asserts the handle
renders (same shape as `ProofreadRules.test.tsx`). Browser-verified the drag by
dispatching synthetic PointerEvents after no-op'ing `setPointerCapture` — see
[[browser-verify-readest-web-recipe]]. Note `javascript_tool` timed out at 45s
mid-drag even though the script was ~1s (dnd-kit autoscroll rAF); send the
`pointerup` in a SECOND call and the drop still completes.

**i18n:** only 4 new keys; `Drag to reorder`, `Enable`, `Turn Off` already existed
in all 33 locales. Followed [[i18n-extract-prunes-keys]] — the extractor wanted to
add ~50 unrelated pending keys and prune one, so locales were reverted and the 4
keys appended by script.

Related: [[opds-fixes]], [[opds-autodownload-tombstone-5658]].
