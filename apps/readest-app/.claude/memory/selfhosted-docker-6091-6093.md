---
name: selfhosted-docker-6091-6093
description: "Two self-hosted Docker bugs fixed together — Next 16 truncates any request body over proxyClientMaxBodySize (10MB default) because middleware.ts matches /api/*, and the Cloud Sync Premium chip keyed off sign-in instead of entitlement"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1a5dc2d9-f502-4d77-b951-d9c557c40b00
  modified: 2026-09-06T15:03:45.199Z
---

**MERGED #6100** (squash `731b13ab6`, 2026-09-06). Both fixed in one pass; UNRELEASED, so a
self-hoster on `latest` only picks it up after the next image build from main.

## #6091 — bodies over 10MB silently truncated

`middleware.ts` matches `/api/*`, so Next buffers a **clone** of every non-GET
request body. `next/dist/server/body-streams.js` `getCloneableBody` caps that
clone at `experimental.proxyClientMaxBodySize` (**default 10485760**) and, past
the limit, pushes `null` into **both** streams — `p1` (handed to the middleware)
and `p2`, which `finalize()` splices back over the `IncomingMessage`. So the
**route handler** sees a short body ending cleanly: no error, no 413, a stored
file of exactly 10,485,760 bytes. Only a `console.warn` on the server.

This bites upstream today at `pages/api/send/inbox/file.ts`, which accepts
`SEND_INBOX_FILE_MAX_BYTES` = 40 MB. Book uploads are NOT affected upstream:
`getUploadSignedUrl` only knows `r2`/`s3` and presigns straight to the bucket,
so the body never crosses the Next server. The reporter's "local storage
backend" is not in this repo — a fork, or a custom proxying setup.

Fix: `proxyClientMaxBodySize: standaloneOutput ? 1GB : 32MB` in
`next.config.mjs` (chrox's numbers). The clone is held in RAM for the life of the
request and the buffering happens BEFORE any handler can reject, so the ceiling
doubles as an unauthenticated memory-exhaustion budget on every `/api/*` route —
only the self-hosted image gets real headroom. Number (bytes), not the string
form, so `src/__tests__/next-config.test.ts` can compare the two builds.

**32MB is deliberately BELOW `SEND_INBOX_FILE_MAX_BYTES` (40MB)**, so a 32-40MB
inbox EPUB still truncates on a plain `next start`. Accepted: Cloudflare
(OpenNext/workerd) and Vercel never run `next-server.js`'s `attachRequestMeta`,
so no production deployment reaches this code path except the Docker image. The
"covers the largest route body" assertion therefore lives on the SELF-HOSTED
config; the default build only has to beat Next's 10MB.

**`standaloneOutput` (i.e. `BUILD_STANDALONE`) is the self-host discriminator at
BUILD time**: the Dockerfile is the only thing that sets it, and web.readest.com
runs on Cloudflare/Vercel, never on that image. `SELF_HOSTED` cannot serve here —
CI builds the image without it (it is a compose-time runtime var), and a
standalone build bakes next.config into `required-server-files.json`, so a
runtime env knob would be dead anyway. Test the standalone branch by stubbing
BOTH `BUILD_STANDALONE=true` and `NEXT_PUBLIC_APP_PLATFORM=web` — without the
latter, `exportOutput` is true under vitest and forces `standaloneOutput` false.

Next dev prints `· proxyClientMaxBodySize: 268435456` under "Experiments" —
cheapest confirmation the value took.

## #6093 — WebDAV shows "Premium" on a self-hosted deployment

`isCloudSyncAllowed` → `isCustomizationAllowed` → `isSelfHosted()` already
returned true, so the row **opened fine and sync was never paused**. The only
defect was the chip:

```ts
!user || (userProfilePlan !== undefined && !isCloudSyncPremium)  // old
```

`!user` short-circuits, so a signed-out self-hoster (the normal state right
after `docker compose up`) got a Premium badge on every third-party provider —
which reads as "not available in this deployment". Fix is
`shouldShowCloudProviderBadge` in `integrations/cloudSyncStatus.ts`:
`!isPremium && (!signedIn || !planLoading)`. **Entitlement decides, sign-in does
not** — self-hosting unlocks with or without a user.

Verified live both ways: `SELF_HOSTED=true pnpm dev-web`, signed out →
`/runtime-config.js` serves `{"selfHosted":true}`, no badges, WebDAV form opens;
then `window.__READEST_RUNTIME_CONFIG = {}` + a settings-tab round trip →
badges return. The second half matters, it proves the hosted paywall still works.

Second cause for the same symptom: `SELF_HOSTED` only reached the container
through `compose.yaml` (`${SELF_HOSTED:-true}`, added in #5996 on 2026-09-01).
**A compose file copied before that date does not pass it through and `docker
compose pull` never updates it**, so the deployment stayed gated with nothing on
screen to explain why. Fixed in the image itself: **`ENV SELF_HOSTED=true` in the
Dockerfile production stage**, on the same premise as the build-time gate above —
the published image IS the self-hosted artifact. A compose file that does pass
the variable still overrides it, so `SELF_HOSTED=false` remains the escape hatch
for anyone selling plans off this image. Guarded by
`src/__tests__/docker-image-defaults.test.ts`, which greps the production stage —
dropping that ENV silently re-gates every self-hoster.

See [[storage-customization-entitlement-split]].
