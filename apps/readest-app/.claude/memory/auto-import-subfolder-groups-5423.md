---
name: auto-import-subfolder-groups-5423
description: "#5423 auto-import ignored 'Create groups from subfolders'; the group hint is SelectedFile.basePath, and the per-folder flatten pick was never persisted"
metadata:
  node_type: memory
  type: project
---

Issue #5423 (Windows, 0.11.20): a folder imported with "Read books in place" +
"Auto-import new books from this folder" + "Create groups from subfolders"
grouped its books on the initial import, but every later auto-imported book
landed at the library root.

Two causes, both in `src/app/library/page.tsx`:
- **Grouping is carried by `SelectedFile.basePath`, nothing else.** `importBooks`
  → `processFile` derives `groupName` from `getDirPath(path)` relative to the
  *parent* of `basePath`, so the imported folder itself is the top-level group
  ("Books") and subfolders nest under it ("Books/SciFi"). `runFolderImport`
  attaches `basePath` in keep mode; `autoImportFromWatchedFolders` pushed bare
  `{ path }` → `groupId` stayed undefined → root.
- **The per-folder "Folder Structure" pick was never persisted.**
  `settings.autoImportFolders` is only `string[]`; the keep/flatten radio lived
  in localStorage as a *global* "last used" default for the dialog, so the scan
  had nothing to reproduce.

Fix (MERGED 2026-08-02 as PR #5436, squash merge commit `8a259d332`):
- `toWatchedFolderImports(folder, entries, flatten)` in `services/bookService.ts`
  builds the importer inputs; **both** the manual folder import and the scan call
  it, so the two paths cannot drift again.
- `getFolderImportGroupName(filePath, basePath)` extracted to `utils/path.ts`
  (was inline in `processFile`); backslashes normalize, so Windows derives the
  same names.
- New device-local `settings.autoImportFlattenFolders?: string[]` (subset of
  `autoImportFolders`, also in `BACKUP_SETTINGS_BLACKLIST`) records only the
  flattened folders. **Absent = grouped**, so folders watched before the fix
  start grouping without the user re-running the dialog — deliberate, since
  "Create groups from subfolders" is the dialog default; the cost is that a
  legacy *flatten* watcher sees new books land in a folder-named group until
  they re-run the import once.

Test: `src/__tests__/services/auto-import-folder-groups.test.ts` (scan → inputs →
derived group names, keep + flatten + Windows paths). The wiring itself is
desktop/Android-only and was not run in a real app build.

The same PR's second commit adds a **Watched Folders sub-page** to the
Import-from-Folder dialog (`WatchedFoldersPane.tsx`) — before it, the only way
to unwatch a folder was to re-pick that exact path and untick a checkbox, and
nothing listed the watched set. Notes for future work there:
- The dialog keeps `<Dialog>` as the root of BOTH branches and early-returns for
  the sub-page. Wrapping the form in a ternary instead re-indents ~450 lines and
  makes the diff unreviewable.
- Escape still closes the whole dialog from the sub-page: `<Dialog>` and
  `useKeyDownActions` both listen on `window`, and the hook's
  `stopPropagation()` does not stop the sibling listener. Android Back does go
  back one level, because `eventDispatcher.onSync` stops at the first handler
  returning true and the child's hook registers first.
- Row edits persist immediately (Cancel does not roll them back); the dialog
  syncs its own auto-import checkbox / structure radios when the edited folder
  is the one in the path field, or OK would rewrite what was just changed.
- `setAutoImportFolder` must not re-append an already-listed path, or rows jump
  around as the user flips a structure select.
- Rebasing this PR conflicted in ALL 33 locale files (main's #5435 appended its
  keys where mine landed). Resolve as a key union — take main's file, re-add only
  your commit's new keys — then assert every upstream key is still byte-identical
  to `origin/main` before continuing the rebase.
- Local preview trick for dialog-only UI: a throwaway `src/app/<name>/page.tsx`
  rendering the component + `pnpm dev-web` on a spare port; root layout already
  provides EnvProvider/Providers. `document.documentElement.setAttribute
  ('data-eink','true')` from the console covers the e-ink pass. Delete the page
  afterwards.

Related: [[auto-import-duplicate-files-reimport]].
