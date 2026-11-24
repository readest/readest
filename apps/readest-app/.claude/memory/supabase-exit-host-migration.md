---
name: supabase-exit-host-migration
description: "Plan to leave Supabase via host moves: readest.supabase.co -> project-ref URL (step 1 MERGED #6729) -> auth.readest.com custom domain -> own instance; steps 2-3 ON HOLD; gotchas per step"
metadata:
  node_type: memory
  type: project
  originSessionId: 5d5b5ba3-ec6e-4b2a-afff-e7793066579e
  modified: 2026-11-02T18:45:18.525Z
---

chrox is considering migrating Readest Cloud off Supabase (decided 2026-10-12). Plan, driven by Supabase allowing EITHER a vanity subdomain OR a custom domain, not both:

1. Clients -> `https://vbsyxfusjjqdxkjqlysc.supabase.co` (project-ref URL, works under either). MERGED #6729 (074603ce6), UNRELEASED as of 2026-10-12. Covered app `.env` default, koplugin (saved-settings migration in `ReadestSync:init`), Calibre plugin default. `src/utils/supabase.ts` pins `storageKey: 'sb-readest-auth-token'` for readest.supabase.co / project-ref / auth.readest.com, because supabase-js derives the key from the host's first label and a host change would sign everyone out.
**Steps 2 and 3 are ON HOLD (chrox, 2026-10-12): do not start them unless chrox says so.**

2. After old clients drain (measure `readest.supabase.co` Host in edge_logs): remove vanity subdomain, activate custom domain `auth.readest.com` (CNAME, NOT an HTTP redirect: CORS preflights can't follow redirects), ship clients pointing at it.
3. Point `auth.readest.com` at a self-hosted GoTrue/Postgres; second drain for project-ref-only clients.

**Decision 2026-11-03 (chrox):** go with the custom domain (step 2) for #6416 (India ISP blocks on *.supabase.co), NOT a reverse proxy (proxy can't fix OAuth callbacks/email links, and needs a secret key + Sb-Forwarded-For to avoid shared per-IP auth rate limits). Revisit the drain between 2026-11-17 and 2026-12-01, then switch once old-host clients are few. VPS/Hetzner offload of sync was weighed and judged not worth it.

**Update 2026-11-06 (chrox):** for now, ALSO proxy email/password through a Worker (`workers/auth-proxy`, host `auth-cf.readest.com`; `auth.readest.com` stays reserved for step 2). Client MERGED #7355 UNRELEASED; Worker DEPLOYED 2026-11-05. Partial fix: #6416 stays open. KOReader and Calibre plugins still sign in directly. Client rewrites only password + refresh_token grants and /logout, on Readest Cloud hosts. OAuth, magic links and reset links still need the custom domain. Must use an `sb_secret_` key + `security_sb_forwarded_for_enabled` BEFORE clients ship: Worker traffic is one IP to Supabase, and auth-js signs users out on a refresh 429/4xx/HTML 500 (`refreshSession` runs every launch). Chromium `--host-resolver-rules` was silently ignored under Playwright; block hosts with `page.route` + `abort('namenotresolved')` and always run the old code to prove the block.

Drain measurements, the server-side callers that were repointed, and the edge_logs query recipe are in [[private-supabase-host-drain-2026-11]] (local only, gitignored).

**Gotchas:**
- OAuth `redirect_uri` is set by the auth server, not the client host: it becomes the project-ref callback when the vanity subdomain is removed and `auth.readest.com/auth/v1/callback` after activation. Register both at Google/Apple/etc BEFORE step 2.
- Both hostnames share Cloudflare IPs, so a host switch doesn't fix VPN "Load failed (readest.supabase.co)" errors (that report was a VPN issue, fixed by switching VPN).
- Check Cloudflare build/Worker env for `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` overriding the default (not verified in-repo).
- Step 3 keeps sessions valid only if the ES256 private key and legacy HS256 secret move too; see [[private-supabase-signing-keys-migration-2026-10-12]].
- DB access is already server-side only (API routes); auth is the client-facing lock-in.
- Alternative weighed: Worker reverse proxy at auth.readest.com (one release) — risk: Supabase Auth per-IP rate limits would see Worker IPs.
