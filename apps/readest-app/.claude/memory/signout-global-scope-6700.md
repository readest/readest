---
name: signout-global-scope-6700
description: "#6700 sign-out on one device logged out all devices; profile logout fixed by PR #6709, two global signOut calls remain"
metadata:
  node_type: memory
  type: project
  originSessionId: 2673ba56-b095-4344-8ec3-4c12c8a3928c
  modified: 2026-10-12T09:26:37.256Z
---

Supabase `signOut()` defaults to `scope: 'global'` (revokes every device's refresh token). PR #6709 (merged 2026-10-12) changed `AuthContext.logout()` to `signOut({ scope: 'local' })`.

Still UNFIXED:
- `src/app/auth/page.tsx` `tauriSignInApple` / `tauriSignIn` call bare `supabase.auth.signOut()` before OAuth; a lingering SDK session there revokes other devices too.
- Offline logout: auth-js `_signOut` returns early on a network error WITHOUT `_removeSession()`, so the SDK session survives while the app clears `token`/`user`/`keepLogin`; next launch's `refreshSession()` can resurrect it. Possible link to #6700's login-loop report.

**Why:** #6700 also reported a login loop / stuck keepLogin and an iPad Plans layout bug, both out of #6709's scope.
**How to apply:** when touching auth or #6700 follow-ups, pass `{ scope: 'local' }` to these calls too and handle the signOut error path.
