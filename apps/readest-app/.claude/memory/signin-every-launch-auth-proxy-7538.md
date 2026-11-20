---
name: signin-every-launch-auth-proxy-7538
description: "#7538 Windows asked to sign in every launch: refresh goes via auth-cf proxy since 0.12.20; fallback to Supabase host + null INITIAL_SESSION fix MERGED #7540, reporter unconfirmed"
metadata:
  node_type: memory
  type: project
  originSessionId: 1565ef30-4d64-44b7-91fb-9546aa7de426
  modified: 2026-11-17T15:31:24.185Z
---

MERGED #7540 as cdf29257b (2026-11-17). #7538 left open until the reporter answers (asked whether auth-cf.readest.com opens for them).

**Likely cause (unconfirmed, no Windows box):** since v0.12.20 (#7355) `proxyAuthFetch` sends refresh_token/password grants and logout to `https://auth-cf.readest.com`, while Google OAuth stays on the Supabase host. A network that blocks the new proxy host can sign in but never refresh, so every launch >1 h after sign-in has an expired session; on desktop `getAccessToken` uses `supabase.auth.getSession()`, sync throws "Not authenticated" and `useSync` sends the user to sign-in. Fix: a proxied request that throws (no answer) falls back to the Supabase host; any proxy answer is final, so #6416 users still use the proxy.

**Second path (confirmed in tests):** supabase-js 2.105 keeps its stored session on a retryable refresh failure but still emits a null INITIAL_SESSION (`_emitInitialSession` catches the `__loadSession` error); `AuthContext` used to wipe token/refresh_token/user on it. Also the SDK's own startup `_recoverAndRefresh` runs at client creation, before AuthProvider subscribes, so a SIGNED_OUT from a non-retryable failure there never reaches the app. Now a null INITIAL_SESSION calls `refreshSession({refresh_token})` with the app's token (not awaited inside the SDK callback) and only a non-retryable error signs out.

**Test gotchas:** `vi.resetModules()` does NOT re-run a `vi.mock` factory, so a "fresh client per test" needs the mock to return a getter over a holder the test fills. Give each test client its own storageKey, or a client stuck mid-retry holds the navigator lock for the next test. SDK refresh retries run up to 30 s: use fake timers + `advanceTimersByTimeAsync`. CodeQL flags `String(url).startsWith(PROXY_URL)` even in tests; compare `new URL(...).origin`.

Related: [[signout-global-scope-6700]] (auth page `tauriSignIn` still calls `supabase.auth.signOut()` with default global scope — not changed).
