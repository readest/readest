---
name: backup-windows-zip-paths-4703
description: Backup zip exported on Windows failed to restore anywhere — backslash separators in zip entry names
metadata: 
  node_type: memory
  type: project
  originSessionId: dd015419-996e-466b-8039-f2d98312d9d6
---

#4703: Backup `.zip` exported on Windows wouldn't restore on any platform (Web/Android/Windows) — books restored with metadata but missing files/covers.

**Root cause:** `appService.readDirectory` returns paths with the host separator. On Windows `nativeAppService.readDir` → `getRelativePath` strips the base prefix but leaves backslashes, so `file.path` is `hash\cover.png`. `addBackupEntriesToZip` used `file.path` verbatim as the zip entry name. Restore (`restoreFromBackupZip`) matches a book's files by `e.filename.startsWith(`${hash}/`)` (forward slash) → backslash names never match → all files silently skipped. (The "garbled Unicode" reported in zip viewers was just the `\` rendered oddly.)

**Fix (export side only):** normalize the zip entry name to forward slashes — `file.path.replace(/\\/g, '/')` — in `addBackupEntriesToZip` (`src/services/backupService.ts`). Keep `file.path` (host separators) for `readFile`. Test: `backup-windows-paths.test.ts` drives the now-exported `addBackupEntriesToZip` with a capturing ZipWriter stub + Windows-style backslash listing (no zip.js workers needed; the forced `useWebWorkers`/`useCompressionStream` config makes a real round-trip impractical under jsdom).

**General lesson:** `readDirectory`/`readDir` paths carry host separators; normalize to `/` at any cross-platform boundary (zip entries, sync keys, anything serialized for another device). Already-broken Windows backups still need re-export — restore was left unchanged (minimal fix; matches the issue's expected behavior). See [[platform-compat-fixes]].
