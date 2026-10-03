---
name: koplugin-session-expired-6428
description: #6428 Kobo "auth refresh failed" = dead Supabase refresh token; plugin never re-prompted login; MERGED #6445 (489eb705d) UNRELEASED; NOT fixed by 0.12.10-2
metadata:
  type: project
---

#6428 (Kobo, 0.12.10): upload fails "auth refresh failed". 0.12.10-2 koplugin zip == main at df79ae036 (#6364, /tmp response file) and does NOT touch the refresh path: `SupabaseAuthClient:refresh_token` runs in-process via Spore, never the forked worker. Reporter's crash.log had no Readest lines (wrong day).

Fix MERGED #6445 (489eb705d; commits 550b287a1+ba1b779cd, 2026-09-29): refresh callback gets HTTP status (spec json expected_status 400/401/403 -> status present only when the server answered; network errors raise -> no status). Status => clear tokens (keep email), cb(false,"session expired"), THEN ConfirmBox -> SyncAuth:login (after cb so the caller's toast doesn't cover it; dedupe via refresh_token nil). tryRefreshToken now delegates to withFreshToken. Review round (ba1b779cd): expire ONLY on status 400/401/403 (not any status); expireSession(settings,path,rejected_token) clears only if settings.refresh_token still == the token that failed (stale concurrent rejection must not wipe freshly saved tokens; also replaces the prompt-once guard). Button reuses existing "Login" msgid. Not device-tested. Reply posted on issue with logout/login workaround.
