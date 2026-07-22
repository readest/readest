---
name: hardcover-progress-edition-id-4792
description: Hardcover progress sync parse-failed — edition_id falls back to book_id; invalid edition rejected by Hasura Action
metadata: 
  node_type: memory
  type: project
  originSessionId: 6273b46d-b22d-4d48-9295-7420b251a197
---

Issue #4792 (v0.11.12) — FIXED in PR #4794 (branch `fix/hardcover-progress-edition-id`). "Hardcover sync fails completely despite successful API key auth." Auth (`GetUserId`) works; progress push fails with:
`GraphQL Errors: [{"message":"parsing Hasura.GraphQL.Execute.Action.Types.ActionWebhookErrorResponse failed, key \"message\" not found","extensions":{"code":"parse-failed"}}]`

**Root cause (verified live in Chrome, account chrox, book "Crime and Punishment"):** `HardcoverClient.pushProgress` → `MUTATION_UPDATE_READ` (`update_user_book_read`) sent `edition_id: 713309`, which is the **book_id**, not a real edition id. `update_user_book_read`/`insert_user_book_read` are Hardcover **Hasura Actions**; an invalid edition makes the Action handler throw and return a non-conforming error body, which Hasura surfaces as the generic `parse-failed` (`ActionWebhookErrorResponse` missing `message`). HTTP status is 200 — the error is GraphQL-level only.

**Why edition_id == book_id:** title-search path in `fetchBookContext` (`HardcoverClient.ts`). `QUERY_SEARCH_BOOK` (`per_page:1`, returns raw `results`) does **not** select `featured_edition_id` — confirmed the hit `document` has no such key. So `searchBookByTitle` does `editionId = featured_edition_id ?? bookId` → always `bookId`. Then `QUERY_GET_BOOK_USER_DATA` only resolves a real edition via `selectedEdition` (the user_book's / read's `edition`); here both were `null` (user added the book with no specific edition), so `editionId` stays `bookId`. Broad impact: any no-ISBN (title-matched) book whose Hardcover library entry has no edition selected sends `edition_id = book_id`.

**Fix shipped (PR #4794):** `BookContext.editionId` is now `number | null`; `searchBookByTitle` drops the `?? bookId` fallback (null when no `featured_edition_id`); `$edition_id` made nullable (`Int`) in `MUTATION_INSERT_READ`/`MUTATION_UPDATE_READ`/`MUTATION_INSERT_JOURNAL`; `insert_user_book` omits `edition_id` when null. Verified live: book id → `parse-failed`; real edition id → `error:null`; `edition_id:null` → `error:null` and is a no-op (does NOT clear an existing edition).

**NOT a recent Readest regression:** the buggy `editionId = featured_edition_id ?? bookId` fallback + `edition_id: context.editionId` in the read mutations exist unchanged since the original feature #3724 (2026-04-03). It surfaces now because auto-sync (#4614, 2026-06-16, shipped v0.11.10/v0.11.12) made progress-push run automatically on every page turn (debounced) and via the BookMenu "Hardcover Sync → Push Progress". Possibly compounded by Hardcover tightening server-side edition validation. Secondary: title search also mis-matches (e.g. matched a Harold Bloom study guide, not Dostoevsky's novel) — separate match-quality concern.

Files: `src/services/hardcover/HardcoverClient.ts` (`fetchBookContext` ~306-426, `searchBookByTitle` ~286-289, `pushProgress` ~499-536), `src/services/hardcover/hardcover-graphql.ts` (`QUERY_SEARCH_BOOK`, `MUTATION_UPDATE_READ`/`MUTATION_INSERT_READ` ~131-155). Proxy: `src/app/api/hardcover/graphql/route.ts` forwards client `authorization` header.
