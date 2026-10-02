---
name: calibre-plugin-custom-columns-filter
description: Calibre plugin pushed custom columns as metadata.customColumns dict that nothing in the app read; fixed to calibreColumns + bookshelf value picker
metadata:
  node_type: memory
  type: project
  originSessionId: d543e889-0c24-42ca-b5e1-cda15ee7e3ab
  modified: 2026-10-01T17:15:06.733Z
---

User report (2026-10-02): Calibre custom columns (e.g. "Shelves") were listed in the bookshelf filter editor on macOS/iPad but no book matched, and they were missing on web.

Root cause: the plugin (wire.py build_metadata) wrote `metadata.customColumns = {label: value}`, but the app only reads `metadata.calibreColumns` (`[{label,name,datatype,value,extra}]`, the foliate-js OPF parse). Columns only appeared where a downloaded file had been parsed locally, and cloud metadata pulls could replace those.

MERGED #6538 (19a4ffe27) 2026-10-02, UNRELEASED, worktree + branch removed: wire.calibre_columns() emits the OPF shape (values come from mi.get, so composite columns get evaluated; verified against real calibre-debug). After updating the plugin, users must push again; the plan then reports "Metadata differs". Also added a bookshelf value picker (`suggest`/`values` on BookshelfField + a datalist in BookshelfFilterEditor) and a `downloadStatus` field (localOnly/downloaded/cloudOnly; local = downloadedAt||absDownloadedAt, which import also stamps). Chrome-verified on the LAN URL. There `+` (new bookshelf) throws because crypto.randomUUID is missing in a non-secure http context; that only affects this test setup.

Plugin tests test_oauth roundtrip + test_version fail on main too (sandbox loopback / version drift), unrelated.
