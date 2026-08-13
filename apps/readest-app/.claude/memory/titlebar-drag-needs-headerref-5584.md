---
name: titlebar-drag-needs-headerref-5584
description: "Desktop window dragging is JS-driven: any page header must pass headerRef to WindowButtons and exclude its inputs, or its title bar is dead (issue #5584, OPDS)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3333d399-89ba-4b83-b5c3-66573a9abf69
  modified: 2026-08-09T07:14:30.396Z
---

Window dragging on desktop is **not** native chrome. `WindowButtons`
(`src/components/WindowButtons.tsx`) attaches `mousedown` / `pointer*`
listeners to the *page's own header element* and calls
`getCurrentWindow().startDragging()`. The effect bails at
`const headerElement = headerRef?.current; if (!headerElement) return;`, so a
header that renders `<WindowButtons>` **without** `headerRef` has a completely
dead title bar while every other view drags fine.

That was #5584: OPDS `src/app/opds/components/Navigation.tsx` built a
`headerRef` for traffic-light centering (`useTrafficLight`) but never handed it
to `WindowButtons`. Present since the OPDS browser landed. MERGED #5592
(squash `df2989e43`). Never verified by dragging a real macOS build; the
`pnpm tauri dev` run was stopped one link step short, so only the jsdom wiring
test backs it.

**Why it is easy to miss:** the ref already exists and is already used, so the
header *looks* wired. The prop type was also `RefObject<HTMLDivElement>` while
OPDS uses a `<header>`, so passing it needed the prop widened to `HTMLElement`
(what `useTrafficLight` already accepts).

**How to apply:** when adding or reviewing any page-level header,
1. pass `headerRef={headerRef}` to `WindowButtons` (references: `LibraryHeader`,
   reader `HeaderBar`, `app/auth/page.tsx`, `app/user/components/Header.tsx`);
2. put `exclude-title-bar-mousedown` on every text input / non-`.btn`
   interactive wrapper inside that header, or mousedown steals focus into a
   window drag. `isExcludedElement` already covers `.btn`, `.window-button`,
   `.dropdown-container`, `.exclude-title-bar-mousedown`.

Regression test: `src/__tests__/app/opds/navigation-titlebar.test.tsx` asserts
header mousedown calls `startDragging` and search-field mousedown does not.
This is wiring, observable in jsdom, so it is not the mock-only-IPC case in
[[feedback-no-mock-only-platform-tests]]. Related:
[[window-title-book-name-a11y-5547]], [[dropdown-floating-ui-portal-5259]].
