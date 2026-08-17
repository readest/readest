---
name: font-sync-download-unknown-error-5675
description: "#5675 font sync 'Unknown error' = missing bundle dir -> os error 2; ROOT-CAUSED + FIXED in PR #5700; mkdir was fused with id minting so the local branch skipped it"
metadata: 
  node_type: memory
  type: project
  originSessionId: d937753c-8e00-4779-97ff-427e8d119ca6
  modified: 2026-08-14T07:15:05.901Z
---

**RESOLVED — PR #5700** (`fix/replica-download-bundle-dir`, 2 commits). Root cause CONFIRMED on-device. `download_file` uses `File::create`, which does NOT create parents, so a missing `Fonts/<bundleDir>/` fails as `No such file or directory (os error 2)`.

**Why the dir was missing (the non-obvious part): mkdir is FUSED with id minting.** `useReplicaPull.createBundleDir` both mints `uniqueId()` AND mkdirs. `applyRow` correctly refuses to call it on the `local` branch (a fresh id would orphan existing binaries and re-download every pull), so it skips the mkdir as collateral damage. Nothing ever re-establishes the invariant. It breaks in the wild because record and files live in DIFFERENT places: `settings.json` is `AppConfig` (internal) while `Fonts/` follows `customRootDir` — `getPathResolver` applies the custom root to Fonts/Books/Images/Dictionaries but **NOT to Settings**. Change the root or clear external storage and every record survives while every bundle dir dies.

Fix = `createDir(getDirPath(lfp), base, true)` in `appService.downloadReplicaFile` — at the DOWNLOAD, not in applyRow, so persisted-queue replay and Retry All are covered too. 2nd commit: replica transfers default `isBackground: true` and the failure path now honors it (it never did; success always had).

**Device A/B proof (Xiaomi, `customRootDir=/storage/emulated/0/Books`):** dir missing -> `failed`, retry 3, `Unknown error`, console `os error 2`; dir present -> `completed`, 379588 bytes exact, `Georgia:loaded`, `@font-face` injected. Full send loop also verified (import -> upload -> manifest -> pull -> download -> mount). **Fresh devices are FINE** — only records that outlive their directory break.

STILL UNFIXED: the `Unknown error` collapse itself (`transferManager.ts:460`). Flagged as follow-up in the PR.

---

Issue #5675 (Android 0.12.1, Russian user, lifetime license). Screenshot = Transfer Queue with **Completed: 0, Failed: 16** font downloads, all labelled `Unknown error` / `Неизвестная ошибка`, toast `Failed to download file: <font>`.

**What is proven (not guessed):**

1. Metadata + manifest DID reach the receiving device. `fontAdapter.unpackRow` returns null when `row.manifest_jsonb` is absent (`adapters/helpers.ts:singleFileFilenameFromManifest`), and `replicaPullAndApply.applyRow` returns early on an empty manifest — so a queued download PROVES the publishing device finished `uploadReplicaFile` (the manifest is committed only from `replicaTransferIntegration.handleReplicaUpload`, post-upload).
2. `/api/storage/download` SUCCEEDED. Every JS-side failure throws a real `Error` with a message: `fetchWithAuth` (`utils/fetch.ts`) rethrows the server's `error` string, `getUserID` null → `Error('Not authenticated')`, missing url → `Error('No download URL available')`, `webDownload` → `Error(...)`. A missing `files` row 404s as `Error('File not found')`. None of those was shown.
3. ⇒ The rejection came from `invoke('download_file')`. `src-tauri/src/transfer_file.rs` has `impl Serialize for Error { serializer.serialize_str(self.to_string()) }`, so Tauri rejects with a **plain JS string**, and `transferManager.ts:460` maps any non-`Error` to the literal `_('Unknown error')`, then stores it at `:502`. **Verified with a throwaway vitest**: `downloadReplicaFile` rejecting with a string → `transfer.error === 'Unknown error'`; rejecting with `new Error('File not found')` → message preserved.

**Consequence — the real defect to fix first:** all four native failure modes (`Forbidden` fs-scope, `Request` network/TLS, `HttpErrorCode` 403/404 from R2, `Io` os-error-2/28) are indistinguishable in the UI AND unlogged. `downloadFile` only `console.error`s. Any user report of this class is undiagnosable. Fix = accept string rejections in `executeTransfer` (`typeof error === 'string' ? error : ...`) before anything else.

**Second, independent defect:** the replica download path NEVER ensures the destination directory exists. `appService.downloadReplicaFile` only does `resolveFilePath(lfp, base)` then hands the absolute path to `tauriDownload` → Rust `File::create` (transfer_file.rs:208 single-threaded / :265 multipart), which fails with os error 2 if `Fonts/<bundleDir>/` is missing. Contrast `downloadBook` (cloudService.ts:327) and `downloadBookCovers` (:280) which both `createDir` first. The bundle dir is created ONLY in `useReplicaPull.createBundleDir`, which `applyRow` calls only on the `!local` branch — every other route in (a persisted-failed transfer replayed from localStorage, Retry All, a `local` record whose dir was lost) writes into a possibly-missing dir.

**Fleet corroboration (Sentry, readest org):** `message:*Readest/Fonts*` returns dozens of `failed to get metadata of path: .../Readest/Fonts/<bundleDir>/<file> ... No such file or directory (os error 2)` on **Android, iOS AND Windows**, releases 0.11.18→0.12.1 — placeholders whose binaries never landed. Not user-specific. Also seen: `failed to create directory ... No space left on device (os error 28)` (unhandled, from `importFont`), and a leaked Android SAF doc-id as a font filename (`primary%3AFonts%2FTaiwanPearl-Regular.ttf`) — `importFont` does NOT `makeSafeFilename` `fileobj.name`.

**Still UNDETERMINED:** which of the four native errors hit this reporter. Needs the error-surfacing fix shipped + a re-report, or an on-device repro. Note one Android 0.12.1 Sentry path was `/storage/emulated/0/Books/Readest/Fonts/...` (custom root dir on EXTERNAL storage) — a plausible `File::create` EACCES source for that subset.

**Also spotted (unrelated but real):** `useCustomFontStore.findByContentId` does NOT filter `deletedAt`, while the persisted fallback in `findFontByContentId` DOES — a soft-deleted local font shadows an alive remote row, so a delete-then-reimport on device A never revives on device B.

**Device probe note:** the connected Xiaomi fuxi (368b0948) runs a RELEASE 0.12.1 — `webview_devtools_remote_<pid>` socket exists but does not serve CDP, `run-as` refused (`package not debuggable`), no root, `/sdcard/Android/data/com.bilingify.readest/files` empty. On-device inspection needs the `pnpm dev-android` devtools build (see [[download-file-scope-android-regression]]).

Related: [[in-place-delete-wiped-originals]] for the fs-scope history, [[download-file-scope-android-regression]] for `ensure_path_allowed`.
