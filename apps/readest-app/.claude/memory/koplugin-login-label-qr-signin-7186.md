---
name: koplugin-login-label-qr-signin-7186
description: "#7186 KOReader 'logged out daily' = needsLogin menu label, not a lost session; QR code sign-in (grant=session) + logout scope=local; combined in PR #7192 (MERGED 2026-11-01 as 314a62d11, unreleased)"
metadata:
  node_type: memory
  type: project
  originSessionId: a642369a-8e91-4db0-a9b1-a0f970410fb0
  modified: 2026-10-31T19:06:41.377Z
---

#7186 (BOOX, plugin 0.12.16): "has to log in every ~24h". Root cause verified on Kindle 2026-11-01: `SyncAuth:needsLogin` returned true once the access token expired (prod JWT lifetime is 60480 s = 16.8 h), so Tools > Readest showed "Log in Readest Account" while the refresh token was fine. An 8.5-day-old refresh token still renewed. Supabase refresh tokens do not expire here.

Owner asked for ONE PR: all three commits are on `feat/koplugin-code-signin` = PR #7192, MERGED as 314a62d11. The two fix branches below were deleted with their worktrees:
- `fix/koplugin-login-label-7186` 1332391fe: needsLogin false while a refresh token exists.
- `fix/koplugin-logout-local-scope` 9024ad3d5: plugin /logout had no scope = GLOBAL (signed the account out everywhere, same class as #6700); now `?scope=local` via optional_params.
- `feat/koplugin-code-signin` af6ca417d: "Sign in with a code" in the login dialog; reuses /api/crosspoint/device/code + approve; /device/token with `grant: "session"` mints a Supabase session (admin generateLink magiclink + verifyOtp on server). Owner chose a normal session over a permanent device key (no migration). /link title now "Link a Reader".

**Why:** owner wanted QR login + asked about permanent login; evidence showed the session was never lost.
**How to apply:** e2e recipe that worked: run `next dev -p 3010 -H 0.0.0.0` in the worktree (prod Supabase, admin key in .env.local), deploy the plugin with readest-sync-api.json base_url swapped to http://<mac-ip>:3010/api, approve the code on web.readest.com/link (prod approve route shares the DB). ko.sh restart (SIGTERM) on Kindle does NOT flush G_reader_settings: anything only saveSetting'd is lost; sign-in now flushes. Never use the plugin's Log out on main against a real account (global scope). Related: [[koplugin-session-expired-6428]].
