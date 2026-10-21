---
name: supabase-exit-host-migration
description: "Plan to leave Supabase via host moves: readest.supabase.co -> project-ref URL (step 1 MERGED #6729) -> auth.readest.com custom domain -> own instance; steps 2-3 ON HOLD; gotchas per step"
metadata:
  node_type: memory
  type: project
  originSessionId: 5d5b5ba3-ec6e-4b2a-afff-e7793066579e
  modified: 2026-10-12T11:13:41.518Z
---

chrox is considering migrating Readest Cloud off Supabase (decided 2026-10-12). Plan, driven by Supabase allowing EITHER a vanity subdomain OR a custom domain, not both:

1. Clients -> `https://vbsyxfusjjqdxkjqlysc.supabase.co` (project-ref URL, works under either). MERGED #6729 (074603ce6), UNRELEASED as of 2026-10-12. Covered app `.env` default, koplugin (saved-settings migration in `ReadestSync:init`), Calibre plugin default. `src/utils/supabase.ts` pins `storageKey: 'sb-readest-auth-token'` for readest.supabase.co / project-ref / auth.readest.com, because supabase-js derives the key from the host's first label and a host change would sign everyone out.
**Steps 2 and 3 are ON HOLD (chrox, 2026-10-12): do not start them unless chrox says so.**

2. After old clients drain (measure `readest.supabase.co` Host in edge_logs): remove vanity subdomain, activate custom domain `auth.readest.com` (CNAME, NOT an HTTP redirect: CORS preflights can't follow redirects), ship clients pointing at it.
3. Point `auth.readest.com` at a self-hosted GoTrue/Postgres; second drain for project-ref-only clients.

**Gotchas:**
- OAuth `redirect_uri` is set by the auth server, not the client host: it becomes the project-ref callback when the vanity subdomain is removed and `auth.readest.com/auth/v1/callback` after activation. Register both at Google/Apple/etc BEFORE step 2.
- Both hostnames share Cloudflare IPs, so a host switch doesn't fix VPN "Load failed (readest.supabase.co)" errors (that report was a VPN issue, fixed by switching VPN).
- Check Cloudflare build/Worker env for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` overriding the default (not verified in-repo).
- Step 3 keeps sessions valid only if the ES256 private key (keychain) and legacy HS256 secret move too; see [[supabase-signing-keys-migration-2026-10-12]].
- DB access is already server-side only (API routes); auth is the client-facing lock-in.
- Alternative weighed: Worker reverse proxy at auth.readest.com (one release) — risk: Supabase Auth per-IP rate limits would see Worker IPs.
