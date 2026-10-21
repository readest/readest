---
name: supabase-signing-keys-migration-2026-10-12
description: "Prod Supabase rotated to our own ES256 signing key 2026-10-12; EVERY signing-key state change restarts PostgREST (REST 503 burst) — batch changes off-peak, never back-to-back; private key location; legacy HS256 must stay trusted"
metadata:
  node_type: memory
  type: project
  originSessionId: d35f0c20-f458-4e2e-8046-273d5782db53
  modified: 2026-10-12T07:27:15.241Z
---

Prod Supabase moved from the legacy HS256 JWT secret to asymmetric signing keys on 2026-10-12 (Management API `/v1/projects/{ref}/config/auth/signing-keys`), to let API routes verify tokens with `getClaims()` instead of `GET /auth/v1/user` (that call was the largest single source of log ingestion).

**State after migration:** our own ES256 key (kid `3605d9e6-...`) `in_use`; legacy HS256 `previously_used` (still trusted); Supabase's auto-generated ES256 key `revoked` (never signed anything). Private JWK generated locally (not exportable from Supabase otherwise) stored in the macOS login keychain (service `Readest Supabase signing key`, single-line JSON; read with `security find-generic-password -s "Readest Supabase signing key" -w`). The original file was deleted on 2026-10-12, so the keychain item is the only local copy.

**Code:** PR #6724 MERGED 2026-10-12, worktree removed (`validateUserAndToken` -> `getClaims`; JWKS cached 10 min per isolate in `GLOBAL_JWKS`). Log savings need the Worker deploy (`pnpm deploy`); verify by comparing server-side (empty UA) `/auth/v1/user` vs `/auth/v1/.well-known/jwks.json` in edge_logs. If the JWKS fetch rate is high, pass `getClaims(token, { keys })` from an env var.

**Outage lesson:** every signing-key status change / import restarts PostgREST ("Starting PostgREST" in postgrest_logs) and REST returns 503 for a few seconds. Two changes 4s apart at 07:14Z gave ~1 min of mostly-503 REST. Importing the legacy secret also auto-creates a Supabase-generated standby key, and standby can only go to in_use/previously_used, so getting your own key in costs extra restarts. Changes are throttled ~5 min.
**How to apply:** do key changes off-peak, one at a time, and watch edge_logs 503s per minute between them.

**Do NOT revoke the legacy HS256 key** until the anon/service_role JWT keys are replaced by publishable/secret keys: the anon key is baked into shipped apps (`NEXT_PUBLIC_DEFAULT_SUPABASE_KEY_BASE64`) and old versions would break. Self-hosted docker stack stays HS256; `getClaims` falls back to `getUser` there.

Logs API gotcha: `analytics/endpoints/logs.all` is removed; use `analytics/endpoints/logs` with ClickHouse SQL over a single `logs` table filtered by `source` (`edge_logs`, `auth_logs`, ...), fields in the `log_attributes` map, max 24h range. Related: [[supabase-outage-2026-08-31-compute-and-bloat]].
