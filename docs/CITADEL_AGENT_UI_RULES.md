# Citadel Agent UI Rules

These rules are for agents working on Citadel reader UI tasks. They are meant
to prevent long loops of tiny CSS guesses that are never checked in the actual
app.

## Required workflow

1. Identify selector and layer ownership before editing.
   - Use `docs/READER_UI_ANATOMY.md`.
   - For reader frame work, map the visible issue to the exact frame selector
     first.
2. Capture visual evidence before and after visual UI changes.
   - Run the visual harness when a real reader URL is available.
   - Never report `/library` smoke output as reader verification.
3. Use debug-layer mode when a change is invisible.
   - Do not guess through repeated micro CSS nudges.
   - Run with `READER_DEBUG_LAYERS=1` to see which layer is actually moving.
4. Keep changes scoped to the allowed owner files.
   - Reader shell/frame: `ReaderContent.tsx`, `BooksGrid.tsx`
   - Top chrome: `ReaderTopBar.tsx`, `HeaderBar.tsx`
   - Footer/player chrome: `footerbar/FooterBar.tsx`,
     `footerbar/DesktopFooterBar.tsx`, `footerbar/NavigationBar.tsx`
5. Run lint before reporting completion.
   - `pnpm.cmd --filter @readest/readest-app lint`

## Harness commands

Normal screenshot harness:

```powershell
$env:READER_URL = 'http://localhost:3000/reader/<bookId>'; node apps/readest-app/scripts/reader-ui-visual.mjs
```

Debug-layer screenshot harness:

```powershell
$env:READER_URL = 'http://localhost:3000/reader/<bookId>'; $env:READER_DEBUG_LAYERS = '1'; node apps/readest-app/scripts/reader-ui-visual.mjs
```

Expected screenshot outputs:

```text
apps/readest-app/test-results/reader-ui/reader-normal.png
apps/readest-app/test-results/reader-ui/reader-debug-layers.png
```

The harness requires `READER_URL`. If a real reader URL is not available,
report that honestly instead of faking a reader pass with `/library`.

## Reporting rules

Every reader visual task report must include:

- exact files changed
- lint result
- screenshot path or clear reason screenshots were blocked
- whether debug-layer mode was used
- verification status:
  - `Verified in running app`
  - `Not verified`
  - `Blocked by ...`

A visual task is not complete until lint passes and screenshots exist, unless
the report explicitly says it is blocked or not verified.

## Hard boundaries

- Do not touch sidebar files unless the task explicitly says sidebar.
- Do not touch audiobook sync files unless the task explicitly says audiobook
  sync.
- Do not touch Tauri generated/plugin/package files unless explicitly asked.
- Do not alter EPUB text, chapter typography, paragraph CSS, drop-cap rules,
  or GOT sigil logic unless explicitly asked.
- Do not lower footer/player z-index. The footer hover trigger and footer bar
  sit at `z-10`.
- Do not add permanent debug paint. Debug CSS belongs in the harness via
  runtime injection only.
- Do not commit unless explicitly asked.

## Practical guidance

Bigger targeted passes are better than many tiny tweaks. Once the selector map
is known, make one coherent change, run the harness, inspect the screenshot,
and then iterate from visual evidence.

If a change appears to do nothing, stop and run debug-layer mode. The usual
cause is editing the wrong layer, a pseudo-element sitting above the element
you changed, or an image overlay masking the result.
