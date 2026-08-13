---
name: android-intent-filter-pathpattern-needs-host
description: "Android pathPattern is silently ignored without android:host, which turned Readest into the default handler for APKs and every download (MERGED #5610)"
metadata:
  node_type: memory
  type: project
---

`android:pathPattern` / `pathPrefix` / `pathSuffix` in an `<intent-filter>` are **silently ignored unless the same filter also declares `android:host`**. `IntentFilter.matchData()` only walks `mDataPaths` when `mDataAuthorities != null`; the `<data>` docs state it outright ("if a host is not specified, the port attribute and all the path attributes are ignored"). No lint check catches this, and the manifest looks correct.

MERGED #5610 (`05047bd00`), device verify PENDING - the check is `adb shell pm query-activities -a android.intent.action.VIEW -t application/vnd.android.package-archive -d "content://com.android.providers.downloads.documents/document/1"`, which should no longer list `com.bilingify.readest`. The same PR added `text/markdown` + `.md` to these filters; Markdown was the one supported format the hand-written VIEW filters never listed, so it had resolved only through the generated `tauri-file-associations` block.

**How it bit us (`src-tauri/gen/android/app/src/main/AndroidManifest.xml`):** the extension-gated VIEW filter declared `scheme content/file` + `mimeType */*` + ten `pathPattern`s and no host. Every pattern was dead, so the filter registered as *"handle any VIEW intent for any file of any type"*. APKs (`application/vnd.android.package-archive`) matched at the same `MATCH_CATEGORY_TYPE` rank as the system package installer, so Readest showed up in the chooser and stuck once anyone tapped Always. `application/octet-stream` in the sibling filter widened it further (that is what generic download sources report for arbitrary binaries).

**Shape of the fix:** explicit unambiguous ebook MIME types stay ungated (so extension-less `content://` URIs such as Downloads `msf:` documents still open); generic types (`octet-stream`, `zip`, `*/*`) go behind `android:host="*"` plus the extension attributes. `android:host="*"` does match `file:///...` (empty authority) and any `content://` authority, verified against `AuthorityEntry.match`.

**Pair `pathSuffix` with `pathPattern`.** `PatternMatcher`'s simple glob does **not** backtrack: `.*\.epub` stops at the *first* `.` in the path, so `My.Book.epub` never matches. `pathSuffix` is exact but needs API 31+; unknown attributes are a harmless no-op on API 26-30, so listing both is backward safe with `minSdk = 26`.

**Cost accepted:** a `.azw3`/`.fb2` served as `octet-stream` through a provider whose URI path has no filename no longer offers Readest in the chooser. In-app import still works.

**Existing defaults survive the upgrade.** Fixing the manifest does not clear a user's "always open with Readest" preference - that needs Settings > Apps > Readest > Open by default > Clear defaults, or a reinstall. Expect follow-up reports from users who already tapped Always.

**`ACTION_SEND`/`SEND_MULTIPLE` keep `*/*` on purpose** - share-sheet targets are always an explicit user choice and never become a default handler.

**Editing hazard: Tauri codegen strips hand-written XML comments from this manifest.** Running `pnpm worktree:new` (which invokes the Tauri android/icon codegen) rewrote `AndroidManifest.xml` in *both* the new worktree and the main checkout, dropping the Android Auto explainer comment and a freshly added one, while leaving every element intact. A `git apply` of a saved patch reported success and the resulting commit silently deleted an unrelated comment block. **Always `git diff origin/main` the manifest before pushing**, and rebuild from `git checkout origin/main -- <manifest>` + re-edit rather than trusting a patch that survived a codegen run.

Related: [[android-open-with-intent-flow]], [[ios-txt-share-sheet-tauri211-fileassoc]].
