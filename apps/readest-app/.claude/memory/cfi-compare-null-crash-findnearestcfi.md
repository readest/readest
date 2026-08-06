---
name: cfi-compare-null-crash-findnearestcfi
description: "A cfi-less booknote crashes the whole app via CFI.compare; fixed 2026-08-06 by discarding them in bookDataStore, and empty-string cfi is NOT the culprit"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8ab58725-3ddd-4ae4-9fcd-de424cd4f0b3
  modified: 2026-08-06T08:00:04.826Z
---

`CFI.compare(a, b)` in `packages/foliate-js/epubcfi.js:166` dereferences both arguments
with no validation (`if (a.start || b.start)`). Measured behaviour, not inferred:

| argument | result |
|---|---|
| `''` | returns `-1` — **no throw** |
| `null` | throws `Cannot read properties of null (reading 'start')` |
| `undefined` | throws `... of undefined (reading 'start')` |

**The empty string is safe.** That matters, because `transformBookNoteFromDB`
(`src/utils/transform.ts:241`) normalizes a DB NULL to `cfi: cfi ?? ''`. So the Readest
cloud/Supabase path can produce a *useless* note but never this crash. Do not blame
cloud sync for a `null`-flavoured CFI crash — I did at first and it was wrong.

A literal `null` only arrives from paths that parse foreign JSON **without** going
through `transform.ts`:
- **File sync** (WebDAV/Dropbox/OneDrive/S3/local folder) — `services/sync/file/wire.ts`
  `parseRemotePayload` is a bare `JSON.parse` + `schemaVersion` check; `merge.ts` adopts
  remote notes by id; `useFileSync.ts` `setConfig`s them into live state.
- **Backup restore** — `backupService.ts` merges an unvalidated user zip's `config.json`.
- **Foliate importer** (Linux) — `services/annotation/providers/foliate.ts` does
  `cfi: annotation.value` over `JSON.parse(...) as unknown`.

**Why it is a whole-app crash:** consumers call compare inside render-phase `useMemo`s,
so the throw escapes to the App Router boundary at `src/app/error.tsx` — the "Oops!"
screen, which also self-reloads once per 60s via `handleGlobalError`. That page reports
to **PostHog only** (`posthog.captureException`), never Sentry, so **an empty Sentry
search is not evidence the crash isn't happening in the wild.**

**Fixed 2026-08-06, MERGED #5533** (squash `c5d596d89`) in `src/store/bookDataStore.ts`:
`discardUnanchoredBooknotes`
filters `booknote.cfi` inside both `setConfig` and `updateBooknotes` — every write to
`config.booknotes` funnels through those two, so bad notes can't reach live state from
any current or future ingest path, and the clean array is what `saveConfig` persists
(so on-disk data self-heals). One predicate covers null, undefined and `''`. Also
hardened `findNearestCfi` in `src/utils/cfi.ts` (it was the only helper there calling
compare without a try/catch). Tests in `src/__tests__/store/book-data-store.test.ts` and
`src/__tests__/utils/cfi.test.ts`.

**Why a single bad note slipped past the sort that runs before it:** `BooknoteView`'s
`sortedGroups` useMemo sorts each TOC group with `CFI.compare` *before* `nearestCfi`
runs, so you'd expect the sort to throw first. It doesn't when the bad note is alone in
its group — `Array.prototype.sort` never invokes the comparator for length <= 1.

**Pre-existing backstop:** `store/readerStore.ts:244` already filtered cfi-less notes at
book open (commit `1936136`, "fix: handle synced bookmarks without cfi"). It only runs
in `initViewState`, which is why file sync's later `setConfig` bypassed it.

**Separate, still-unfixed data-integrity bug found while tracing this:** the koplugin
never emits a `cfi` key (`readest_syncannotations.lua:88-118`) but does keep Readest's
note `id` on pull, and postgrest-js builds `?columns=` as the union of keys across the
batch — so a KOReader round-trip **NULLs out a previously-good cfi** via
`ON CONFLICT DO UPDATE`. The comment in `src/__tests__/utils/transform.test.ts:205-228`
claims an omitted column "is left untouched on UPDATE", which the `columns=` union
defeats. Result is a surviving-but-anchorless note, not a crash.

See [[minified-stack-module-namespace-frames]] for how the minified frames were decoded.
