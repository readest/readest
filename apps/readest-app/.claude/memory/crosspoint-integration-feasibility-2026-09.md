---
name: crosspoint-integration-feasibility-2026-09
description: "CrossPoint (Xteink X3/X4 firmware) <-> Readest sync feasibility researched 2026-09-05; what the firmware stores, which paths work today, which are blocked on unmerged PRs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b8d3a47-abd0-4891-bb93-5e24bcc3b617
  modified: 2026-09-04T17:16:52.369Z
---

Research spike (2026-09-05) on crosspoint-reader/crosspoint-reader + itsthisjustin/sd-plugins for a "Readest plugin for CrossPoint".

**Facts (verified in source, release v1.5.0 of 2026-08-07):**
- CrossPoint firmware has a built-in KOSync client (`lib/KOReaderSync/`): doc id = KOReader partial MD5 (Binary mode) or md5(filename) (FILENAME is the DEFAULT); progress = KOReader XPath `/body/DocFragment[N]/body/.../text().K`; default server `https://sync.crosspointreader.com` (crosspoint-sync, open source, KOSync-compatible + `/api/v1` extensions incl. stats, bookmarks, connectors that fan out to Hardcover/Readwise/BookFusion/ABS/another KOSync server). Sync is MANUAL from the reader menu.
- Built-in OPDS client with HTTP Basic, search, paging; accepts ONLY `application/epub+zip` acquisition links.
- Local progress = `/.crosspoint/epub_<std::hash(path)>/progress.bin` (spineIndex u16, page u16, chapterPages u16, visibleTextOffset u32): layout-bound, useless off-device.
- NO reading statistics in the firmware (issue #1600 closed, still on roadmap). CrossInk fork has stats.
- SCOPE.md CLOSES new network connectors in firmware; third-party sync must go through crosspoint-sync or SD plugins.
- SD plugin system = firmware PR #3114 (OPEN, unmerged, +6339/-491). `reader.session` stats events = PR #3204 (OPEN, depends on #3114). Plugin events carry percent/bp only, NEVER the XPath. Precedent: samfoy/crosspoint-bookorbit-plugin.
- device.json supports `auth.type: "password"` (silent token mint, re-mint on 401), so Supabase password grant would work for a Readest plugin.

**Verdict:** progress = works TODAY via a shared KOSync server (set CrossPoint matching to Binary; Readest is md5-only); library = needs a Readest-hosted OPDS feed or the plugin PR; stats = impossible until #3204 lands.

**Why:** Readest `book.hash` is the same partial MD5, and Readest already emits/resolves KOReader XPointers and applies cloud `book_configs.xpointer` on open (useProgressSync).

**How to apply:** highest-leverage Readest-side work is a KOSync-compatible server endpoint + per-user sync key, and an OPDS feed of the cloud library (Basic auth). Don't propose firmware changes to CrossPoint. Nothing hardware-verified (no Xteink device). See [[kosync-percentage-reanchor-impossible-path-5980]] for XPointer pitfalls.
