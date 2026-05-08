# Reader UI Harness

A small, practical smoke check that catches the failure modes that visual
polish passes keep introducing — click-blocking pseudo-elements, missing
entry points, broken control wiring, decorative overlays sitting on top of
real controls.

This is **not** a full UI test suite. It is the minimum bar that must pass
before any reader-UI visual change is reported complete.

## When to run it

You **must** run the smoke check before reporting any of these as done:

- changes to the reader shell (`ReaderContent.tsx`, `BooksGrid.tsx` shell CSS)
- changes to the sidebar (`sidebar/SideBar.tsx`, `sidebar/Header.tsx`,
  `sidebar/Content.tsx`, `sidebar/TabNavigation.tsx`)
- changes to the top chrome (`ReaderTopBar.tsx`, `HeaderBar.tsx`)
- changes to the footer / player chrome (`footerbar/FooterBar.tsx`,
  `footerbar/DesktopFooterBar.tsx`, `footerbar/NavigationBar.tsx`)
- adding or modifying frame layers, glow layers, ornament wrappers,
  `::before` / `::after` overlays, texture layers, or any large absolutely
  positioned div in the reader

Lint and build are necessary but **not sufficient** for these changes.
A reader-UI task is only done when the harness passes (or its reported
limitations are explicitly acknowledged in the report).

## How to run it

In one terminal, start the dev server:

```bash
pnpm --filter @readest/readest-app dev
```

Open a real book in the running app so the reader has a populated view, or
ignore that step and let the smoke check inspect the empty/library state.

In a second terminal, run the harness:

```bash
node apps/readest-app/scripts/reader-ui-smoke.mjs
```

Optional environment variables:

- `READER_URL` — full URL to load. Default `http://localhost:3000/library`.
  Pass a `/reader/<bookId>` URL to skip the library and land directly on the
  reader.
- `HEADLESS=false` — open a visible browser window so you can watch the
  probes happen.
- `SLOWMO_MS=200` — slow each Playwright action down for debugging.

If Playwright complains about missing browsers, install Chromium once:

```bash
pnpm --filter @readest/readest-app exec playwright install chromium
```

## What the harness checks

For each check, the harness uses `document.elementFromPoint()` at the
visual center of the target control and reports what is **actually on top**
at that pixel. That is how it detects click-blocking that lint/build cannot.

1. **Hydration overlay** — fails if Next.js renders an error overlay
   (`<nextjs-portal>`).
2. **LIBRARY button** — must be present in `.reader-top-bar
.citadel-library-btn` and be the element on top at its center.
3. **Sidebar entry points** — exactly one of:
   - the open rail (`.sidebar-container`) with at least one nav tab, or
   - the collapsed restore handle (`[data-testid="sidebar-restore-handle"]`)
     on the left edge, present and clickable.
4. **Footer / player area** — hovers the bottom strip first to wake the
   hover-revealed controls, then probes play / next / previous / progress
   slider. Reports what element actually sits on top of each.
5. **Decorative overlays** — sweeps the DOM for absolutely positioned
   elements covering > 40% of either viewport dimension that **lack**
   `pointer-events: none`. These are the usual click-blocking suspects.

## Pass / fail rules for reporting

When closing out a reader-UI task, your report **must** include one of:

- **Verified in running app** — the harness reports `0 fail`, and you eye-
  balled the rendered app at least once. Manual verification of the design
  intent is still required when the change is visual.
- **Not verified** — say it explicitly. Do not infer "looks fine" from a
  green lint+build.
- **Blocked by …** — name the blocker (e.g. cannot start dev server in
  this environment, Playwright browsers not installed, etc.) and include
  the exact command you tried.

A clean lint and a clean `next build` are **not** equivalent to verifying
the running app. Reader-UI tasks must follow the rule above.

## Hard rules every visual pass must follow

These are the rules that, if broken, will cause the harness to fail (or
should). Bake them into every reader-UI change:

1. **Decorative layers must use `pointer-events: none`.** Any overlay,
   `::before`, `::after`, frame layer, glow layer, ornament wrapper,
   texture layer, or aura div that is not intentionally interactive must
   carry `pointer-events: none`.
2. **Do not push interactive controls below the hover-trigger.** The
   footer-bar's hover trigger sits at `z-10`. If you set `z-index < 10`
   on the footer-bar container, its child controls will be unreachable.
3. **Do not delete an entry point without re-adding a replacement.**
   Removing the top-right SidebarToggler without adding the left-edge
   restore handle leaves the user with no way to reopen the sidebar.
4. **Do not break wiring while restyling.** When you reorder JSX or change
   props, re-pass every existing handler (`onGoToLibrary`,
   `onCloseBook`, etc.) explicitly. If a button stops rendering, check
   for a missing prop first.
5. **Lint+build is not the bar.** Both can be green while the page is
   completely broken. Run the harness.

## Extending the harness

Add new probes as the reader gains controls. Keep it small and practical —
this script is intended to be a fast smoke check, not a regression battery.
If a probe needs an open book to work, gate it on detecting reader content
and `record('warn', ..., 'no book open')` instead of failing hard.
