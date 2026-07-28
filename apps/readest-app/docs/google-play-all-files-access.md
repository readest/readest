# Google Play: All files access (MANAGE_EXTERNAL_STORAGE)

The Play Store build ships `MANAGE_EXTERNAL_STORAGE`, same as the direct
download build. Play requires a declaration for it in **Play Console → App
content → Permissions and APIs → All files access**, and the declaration has to
be re-confirmed whenever a release that uses the permission is submitted.

Keep the answers below in sync with what the app actually does. If a release
changes how shared storage is used, update this file first, then the Console.

## Declaration form answers

**Which core feature of your app requires access to All files access?**

> Readest is an ebook reader and library manager. Its core feature is a user
> owned book library that lives in a folder the user picks on shared storage,
> not inside the app sandbox. The app has to enumerate, read, write, rename and
> delete arbitrary document files (EPUB, PDF, MOBI, AZW3, CBZ, FB2, TXT,
> Markdown) anywhere the user keeps them.

**Why can't your app use a more privacy-protective alternative (SAF, Media
Store, app-specific directories)?**

> - The library folder is a stable, absolute filesystem path that is shared with
>   other apps the user runs on the same files: Syncthing, KOReader, Calibre
>   companion tools and desktop sync clients. SAF hands back opaque per-grant
>   tree URIs that are not usable as paths, are not stable across a factory
>   reset or app reinstall, and are not resolvable by the app's native (Rust)
>   file and database layer.
> - The library is a directory tree, not a media collection. It contains
>   documents plus sidecar files the app maintains alongside them (covers,
>   annotation and reading-progress databases, per-book config). MediaStore does
>   not index document formats and cannot represent those relationships.
> - Books must survive uninstall and must be readable by the user with any file
>   manager. App-specific directories are wiped on uninstall and are hidden from
>   other apps, which is exactly the failure users report.
> - The app performs recursive scans of user-selected folders for bulk import
>   and for watched auto-import folders, over libraries of thousands of files.
>   Per-file SAF document URIs make this prohibitively slow and require a
>   separate grant for every folder.

**Features that depend on the permission**

- Change Data Location: move the whole library and its databases to a folder on
  shared storage or an SD card (issues #5372, #2862).
- Import books from a folder, including recursive scans and watched folders that
  are re-scanned on launch.
- Backup and restore of the library archive to a user-chosen folder.
- Save the current book cover to a user-chosen folder for lock screen use.

**Video demonstration**

Play asks for a short screen recording showing the feature in context. Record:
open Settings → Change Data Location, pick a shared folder such as
`/sdcard/Books`, complete the migration, then show the imported books opening
from that folder and the same folder visible in a third-party file manager.

## Notes for the release submission

- Do not remove the permission from `AndroidManifest.xml` for the Play build.
  `scripts/release-google-play.sh` fails the build if it is missing.
- `REQUEST_INSTALL_PACKAGES` is still stripped for Play: the in-app updater is
  disabled on that channel.
- The permission is requested at runtime only when the user picks a shared
  folder, never on first launch. Denying it leaves the app fully usable with its
  default in-sandbox library.
