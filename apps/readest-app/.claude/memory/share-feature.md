---
name: Share-a-Book Feature (in progress)
description: Active implementation of /s/{token} share links + cherry-picks (CFI auto-include, 1-tap library import, branded OG images). All locked decisions and the plan file path.
type: project
originSessionId: e4ddc690-b1a9-4557-855f-d4e67055824f
---
Active feature on branch `dev` as of 2026-05-02. Plan file: `/Users/chrox/.claude/plans/ok-we-will-learn-cosmic-acorn.md` (always read for source of truth before continuing).

**Why:** complement just-shipped annotation deep-links (PRs #4018, #4019) with whole-book sharing. Cloud-sync infra exists; this layers public time-limited links on top.

**How to apply:** these decisions are locked across CEO + eng + design reviews. Do NOT re-litigate when implementing.

## Locked decisions (authoritative)

- **Universal 7-day cap** on share expiry, no tier differentiation, no "Never". All users pick `[1, 3, 7]` days. DMCA-risk reduction.
- **App Router** for all share routes (mirrors `/o` precedent + recent Stripe / AI / IAP / OPDS). Pages API `storage/*` neighbors stay where they are.
- **Single non-dynamic landing page** at `src/app/s/page.tsx` + rewrite `'/s/:token' → '/s?token=:token'` in `next.config.mjs`. Mirrors `/o`'s pattern exactly. Avoids `[token]` dynamic-segment trap under `output: 'export'`.
- **R2 server-side byte-copy** for `/import` (recipient-side library import). NOT a reference. Preserves invariant that every `files` row's `file_key` starts with that row's `user_id` — keeps stats / purge / delete / download routes working unchanged.
- **`token_hash` (sha256) in DB**, never the raw token. Raw token shown to user once at create.
- **Live `(user_id, book_hash)` resolution** at every access (no FK to `files`). Re-uploads of the same hash follow the share automatically.
- **GET `/download` is a 302 redirect with NO DB writes**. Count via separate `POST /download/confirm` so unfurlers / prefetchers can't inflate counts.
- **Atomic SQL `download_count = download_count + 1`**, not read-modify-write.
- **Per-user 50-share cap**, enforced at create-time.
- **Auth detection on /s landing**: server-render via Supabase auth cookie in `app/s/layout.tsx`. No layout shift. Falls back to anonymous flow + post-hydration upgrade if SSR fails.
- **Cover-less `og.png` fallback**: text-only display-type card. NO placeholder rectangle, NO procedural pattern.
- **Universal Links / App Links**: handle `https://web.readest.com/s/...` in v1 via `useOpenShareLink`. Tauri's `applinks` config already covers the host.

## Cherry-picks accepted (CEO review SELECTIVE EXPANSION)

1. **Position-aware share** — every share initiated from the reader auto-includes `cfi`; recipient lands at sharer's paragraph. Toggle in dialog (default on, only visible when reader-context).
3. **1-tap "Add to my library"** — logged-in recipient on `/s` gets primary action that calls `/import` (R2 byte-copy) and navigates to `/reader?ids=...&cfi=...`.
4. **Branded OG image** — `/api/share/[token]/og.png` server-renders via `@vercel/og`. Spec includes anti-slop checklist.

Deferred to TODOS.md: QR code on landing, notify-on-download toggle.

## Open implementation questions (resolve mid-build)

1. Upload-confirmation: HEAD R2 in `/create`, or add `uploaded_at` column to `files`? — recommend HEAD.
2. Migration directory: project has no `apps/readest-app/supabase/migrations/`. Confirm where SQL actually lands before writing the file.
3. `@vercel/og` runtime compat with CloudFlare Workers (OpenNextJS). Verify before relying on it; fallback to Satori + sharp if incompatible.
4. App Router route handlers under `src/app/api/share/...` should be silently dropped by `output: 'export'` in Next 16.2.3. Confirm during first Tauri build.

## Critical files for implementation

See "Critical Files (modify or create)" table in the plan. Key starting points:
- `src/libs/storage-server.ts` — extract `getDownloadSignedUrl` from `pages/api/storage/download.ts`
- `src/libs/share-server.ts` (new) — `generateShareToken()`, `hashShareToken(raw)`
- `src/libs/share.ts` (new) — typed client used by dialog, manage section, deeplink hook, landing page
- `src/utils/share.ts` (new) — `buildShareUrl(token)`, `parseShareDeepLink(url)`
- Dialog reference: `src/components/Dialog.tsx`, `BookDetailModal.tsx`
- Landing reference: `src/app/o/page.tsx` (lift `Card`, `BrandHeader`, `PageFooter` to `src/components/landing/`)
- Deeplink hook reference: `src/hooks/useOpenAnnotationLink.ts`, `useOpenWithBooks.ts`
- App-level upload entry: `appService.uploadBook(book)` at `src/services/appService.ts:269` (NOT `cloudService.uploadBook` — lower-level fn)
