// A scenario probe: whether the page holds a signed-in user (AuthContext's `user`; each app has its
// own, backend.py), whether supabase-js keeps a session (backend.py's server is on localhost), and
// whether this start was handed one (backend.py init: when the app kept none).
globalThis.__parityProbe = () => {
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('user') ?? 'null')?.email ?? null;
  } catch {}
  return {
    signedIn: user !== null,
    session: localStorage.getItem('sb-localhost-auth-token') !== null,
    seeded: !!window.__paritySeeded,
  };
};
