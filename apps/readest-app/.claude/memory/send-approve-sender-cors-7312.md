---
name: send-approve-sender-cors-7312
description: "Send to Readest approve checkmark never worked in the apps: PATCH missing from CORS; MERGED #7312 (8380b8c6f); server-side fix, no app update needed; confirm on production after deploy"
metadata:
  node_type: memory
  type: project
  originSessionId: a6942968-fc90-42d8-b902-87b55ccf7f9c
  modified: 2026-11-04T07:48:38.258Z
---

The checkmark on a pending sender sends `PATCH /api/send/senders`. `PATCH` was missing from `src/middleware.ts`, so every native app had it blocked at preflight ("Could not approve sender") since #4230 (2026-05-20). Add (POST) and remove (DELETE) worked, and web is same-origin. Merged 2026-11-04 as #7312 (8380b8c6f); not yet confirmed live on production at merge time.

- **Which list matters:** the middleware answers every `/api` OPTIONS first, so `corsAllMethods` in `src/utils/cors.ts` is never read for a preflight. A test of it stays green with the real fix reverted, so only `src/__tests__/middleware.test.ts` guards this.
- **After deploy:** merging does not ship this. `web.readest.com` is the Cloudflare Worker, deployed by hand with `pnpm deploy`; the on-merge workflow only deploys Vercel, and no workflow runs the Cloudflare deploy. No app update is needed once that runs. Confirm with a production preflight (`curl -X OPTIONS https://web.readest.com/api/send/senders -H 'Origin: tauri://localhost' -H 'Access-Control-Request-Method: PATCH'`) listing PATCH, then try a real approve in an app, which was not run before merge.
- **Workaround until then:** re-adding the pending address with + approves it, because POST upserts `status: 'approved'`. A rejected email is not kept, so it has to be resent after approval.
- **Reply already sent:** the reporter was told by email this ships in the next update.

**CORS probe recipe:** to reproduce a preflight block in a real engine, load a page from an allowed origin and fetch across to the dev server (`PORT=3010 pnpm dev-web`; WebKit reports `TypeError: Load failed`). Do not fake the page with Playwright `page.route`: with interception on, Playwright can answer preflights itself and hide this kind of bug. A running dev server's `/favicon.ico` on `:3001` is enough of a document for the origin.

Related: [[private-send-email-sender-trust-2026-11]].
