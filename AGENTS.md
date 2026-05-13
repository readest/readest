# Agent Working Notes

This repo is a Tauri + Next.js reader app. Pay attention to the rules below.
They exist because they have been broken before and broken things in user-
visible ways.

## Reader UI changes — required workflow

Lint and build are **necessary but not sufficient** for any change to the
reader chrome / sidebar / frame / footer / background.

Before reporting any reader-UI task complete, you must:

1. Run the smoke harness:
   ```
   node apps/readest-app/scripts/reader-ui-smoke.mjs
   ```
   (See `docs/READER_UI_HARNESS.md` for setup, env vars, and probes.)
2. State the verification status explicitly in your report. Use one of:
   - **Verified in running app** — harness clean **and** you eyeballed the
     rendered app.
   - **Not verified** — say it explicitly.
   - **Blocked by …** — name the blocker and the exact command attempted.
3. A clean `pnpm lint` and a clean `next build` do **not** count as
   verification. Both can pass while the reader is completely broken.

## Hard rules for reader visual passes

These are non-negotiable. Breaking any of them will cause user-facing bugs
that the harness is designed to catch.

1. **Decorative layers must use `pointer-events: none`.** Any frame
   pseudo-element, glow layer, ornament wrapper, texture overlay, aura div,
   or large absolutely-positioned decorative `<div>` must declare
   `pointer-events: none`. The harness flags large absolute overlays that
   forget this.
2. **Do not lower interactive z-index below the hover-trigger.** The
   footer-bar's hover trigger sits at `z-10`. Setting `z-index < 10` on
   the footer-bar container breaks every player and navigation button.
3. **Do not remove an entry point without replacing it.** If you delete the
   top-right `SidebarToggler` you must keep (or add) the left-edge
   `[data-testid="sidebar-restore-handle"]` so the collapsed sidebar is
   recoverable.
4. **Restyling must not silently break wiring.** When reordering or
   restructuring JSX, re-pass every existing handler explicitly
   (`onGoToLibrary`, `onCloseBook`, `onClick`, etc.). If a button stops
   rendering after your change, check for a missing prop first.
5. **Stay scoped.** Reader-UI tasks must not touch:
   - `useAudiobookPlayer.ts`, `useAudiobookSync.ts`, `liveMarker.ts`,
     transcript/sync generation files
   - EPUB iframe text layout / paragraph CSS / chapter typography /
     drop-cap rules / GOT sigil logic
   - `book-themes.ts` resolver
   - Tauri auto-generated permission files

## Other repo rules

- Do not change log levels to suppress errors. Fix the root cause.
- Do not modify Tauri auto-generated permission TOMLs.
- Do not amend commits or force-push without explicit user instruction.
- Audiobook sync code is off-limits unless the task explicitly names it.

## Generated / native files — hands-off policy

These paths are generated or externally managed. Do **not** touch them unless
the task explicitly asks for native/Tauri permission work:

- `apps/readest-app/src-tauri/Cargo.toml`
- `apps/readest-app/src-tauri/plugins/**/permissions/**`
- `apps/readest-app/src-tauri/plugins/tauri-plugin-turso`
- `packages/tauri-plugins`

If those paths appear dirty in `git status`, treat them as pre-existing noise.
Only report them if the current task itself modified them. Do **not** include
them in commits for UI, reader, library, or styling work.

## Process management — no leftover processes

- Prefer one-shot commands over watch / dev-server / persistent processes.
- Do **not** leave these running when a task finishes:
  `pnpm dev`, `pnpm dev-web`, `pnpm tauri dev`, `vitest --watch`,
  Playwright browser sessions, or ad-hoc Node helper processes.
- If a long-running process is strictly required, record the command and PID
  when you start it, stop it before the final report, and confirm cleanup.
- Before the final report, run `git status --short` and list only files
  intentionally changed.

## Where to look first

- Reader shell: `apps/readest-app/src/app/reader/components/ReaderContent.tsx`,
  `BooksGrid.tsx`
- Top chrome: `ReaderTopBar.tsx`, `HeaderBar.tsx`
- Sidebar: `sidebar/SideBar.tsx`, `sidebar/Header.tsx`, `sidebar/Content.tsx`,
  `sidebar/TabNavigation.tsx`
- Footer / player: `footerbar/FooterBar.tsx`, `footerbar/DesktopFooterBar.tsx`,
  `footerbar/NavigationBar.tsx`
- Smoke harness: `apps/readest-app/scripts/reader-ui-smoke.mjs`
- Harness docs: `docs/READER_UI_HARNESS.md`
