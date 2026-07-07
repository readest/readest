---
name: opds-preemptive-basic-digest-400
description: "Calibre digest/'auto' servers 400 the preemptive Basic header from PR #4206; fetchWithAuth must bare-retry on 400 to surface the Digest challenge"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9066b80b-3cb5-44df-9c4b-7f609cf285a5
---

Calibre's content server in `digest` (or `auto` over http) auth mode responds to a `Basic` Authorization header with **400 "Unsupported authentication method"** — not a 401 challenge. PR #4206 (commit 83607d14e) made `fetchWithAuth` (`src/app/opds/utils/opdsReq.ts`) send Basic preemptively (for Calibre-Web-style servers that return anonymous 200 without a challenge), which dead-ended all digest-mode Calibre servers: the retry logic only fired on 401/403, so users saw "Failed to load OPDS feed: 400 Bad Request" (reported on Android, but platform-independent — web proxy relays the 400 too).

**Fix (2026-07-08):** in `fetchWithAuth`, when the first response is 400 AND preemptive Basic was sent, re-issue the request once *without* credentials to surface `WWW-Authenticate`, then let the existing 401/403 negotiation pick Digest. Direct path strips the Authorization header; proxy path strips the `auth=` query param. Tests in `src/__tests__/utils/opds-req.test.ts`.

**Why:** the two auth-server archetypes conflict — anonymous-200 servers need preemptive creds (#4206), strict digest servers reject them with 400. Only runtime negotiation satisfies both; don't "fix" one archetype by regressing the other.

**How to apply:** any preemptive-auth optimization needs a recovery path for servers that reject the scheme outright (400/4xx without challenge), not just for 401/403 challenges. The app's Digest implementation itself is correct (Calibre's strict parser answers 401, not 400, to its headers). Verify against a real Calibre: dummy creds distinguish malformed (400) from wrong-password (401). Beware: Calibre throttles repeated failed logins with transient 503s. Related: [[security-advisories-web-2026-06]] (the *other* OPDS 400 — dev-LAN SSRF block in the proxy).
