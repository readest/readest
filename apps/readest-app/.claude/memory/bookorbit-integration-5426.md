---
name: bookorbit-integration-5426
description: "BookOrbit integration (#5426) — plugin API protocol, xcfi bridge, identity keys, branch feat/bookorbit-integration"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2feb3b1c-398c-4ee5-9b98-c5267fb8ebb9
  modified: 2026-08-04T08:03:02.511Z
---

# BookOrbit integration (#5426) — MERGED #5487 (2026-08-04)

Merged as 9bce2192d; worktree and local branch removed. Spec/plan docs were in the gitignored `.agents/plans/` of the deleted worktree — this memory is the surviving reference. Spec+plan in `.agents/plans/2026-08-04-bookorbit-integration-{design,plan}.md` (gitignored — local only).

**Protocol** (source of truth: `bookorbit/bookorbit` monorepo, `server/src/modules/koreader/` + `koreader-plugin/bookorbit.koplugin/`; the standalone `bookorbit-koplugin` repo does NOT exist — the plugin zip is served by the BookOrbit server itself):
- Base `{server}/api/v1/koreader`; auth `x-auth-user` + `x-auth-key` (md5 password, KOSync-style); creds minted in BookOrbit web UI — NEVER call `users/create`.
- Plugin API `/plugin/`: `version` (capabilities incl. `bookmarkSync`), `match-check`, `annotations/exchange(-ack)`, `bookmarks/exchange(-ack)`, `page-stats`, `book-states`. Limits: ≤20 books, ≤50 changes, ≤5000 keys, ≤50 stats books/request.
- Exchange identity key `k = md5(datetime + "|" + pos0)`; deletion detection via complete key list (`keysComplete`); server pushes down add/edit/delete + `more` paging; device acks with `verified`/`corrected`.
- Positions are crengine toStringV2 xpointers ONLY (`posFormat: 'xpointer'|'pdf'`; CFI never crosses the plugin API — their server converts for its web reader). `src/utils/xcfi.ts` is the bridge; `BookNote.xpointer0/1` already cache them.

**Key design decisions:**
- Identity datetimes derived from `createdAt` in **UTC** + `deviceTime` sent as UTC → all Readest devices derive identical keys. Remote-born note identities persisted in `BookOrbitSyncStore` (sqlite `bookorbit-sync` schema) — not re-derivable.
- Note ids for pulled annotations use the koplugin's `generateNoteId` derivation (`md5("ko:"+hash+":"+type+":"+pos0+":"+pos1).slice(0,7)`) so notes dedupe across the readest.koplugin path.
- Progress sync reuses `useKOSync` via a `KosyncProgressProvider` param (`bookOrbitProgressProvider` derives a KOSyncSettings pointed at `{server}/api/v1/koreader`); FoliateViewer mounts the hook twice with two conflict resolvers.
- Stats: `PageStatEvent` maps 1:1; new `'bookorbit-push'` CursorKey in statisticsDb; no user account gate.
- Layout: `src/services/bookorbit/{types,noteMapping,BookOrbitClient,BookOrbitSyncStore,annotationExchange,bookmarkExchange,notesPass,statsPush}.ts`, hooks `useBookOrbitNotesSync` (Annotator) + provider (FoliateViewer), `/api/bookorbit` proxy (anchored endpoint whitelist), `BookOrbitForm` + panel row.

**CodeQL SSRF on proxies:** `js/request-forgery` flags any self-hosted-server proxy (`/api/kosync` alert #14, `/api/bookorbit` alert #124) — repo pattern is harden then dismiss as false positive (user-provided host is the feature). Real hardening added to bookorbit proxy: `redirect: 'error'` (public server must not 3xx the proxy onto an internal address) + anchored endpoint whitelist + isLanAddress; kosync proxy still follows redirects (untouched for CWA http→https compat). Dismissal comment max 280 chars via `gh api -X PATCH .../code-scanning/alerts/N`.

**Still pending post-merge:** manual smoke against a real BookOrbit server (highlight round-trip, KOReader-created highlight pull, deletes, dogears, stats, status, conflict prompt). Fixed-layout (PDF posFormat) annotations and the catalog API are not supported in v1.
