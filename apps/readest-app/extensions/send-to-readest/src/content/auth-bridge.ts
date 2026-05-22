/**
 * Runs on `web.readest.com` (and the dev host). Reads Readest's Supabase
 * session token out of the page's localStorage and copies it into
 * `chrome.storage.local`, so the extension popup can authenticate to
 * `/api/send/inbox` without prompting the user for credentials.
 *
 * No user data leaves the user's browser — the token is only ever stored in
 * the extension's own storage area, scoped to the extension.
 */

interface SupabaseAuthValue {
  access_token?: string;
}

function findAccessToken(): string | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const value = JSON.parse(raw) as SupabaseAuthValue;
      if (value && typeof value.access_token === 'string' && value.access_token) {
        return value.access_token;
      }
    } catch {
      // Malformed entries are ignored — Supabase occasionally writes partials.
    }
  }
  return null;
}

function syncToken(): void {
  const token = findAccessToken();
  if (token) {
    chrome.storage.local.set({
      readestAccessToken: token,
      readestTokenAt: Date.now(),
    });
  } else {
    // Token went away (sign-out) — clear so the extension stops showing a
    // stale "signed in" state.
    chrome.storage.local.remove(['readestAccessToken', 'readestTokenAt']);
  }
}

syncToken();

// Refresh on storage changes too — Supabase rotates the access token a few
// times an hour. Polling localStorage isn't free, but a `storage` event
// listener fires only when the value actually changes.
window.addEventListener('storage', (event) => {
  if (event.key && /^sb-.*-auth-token$/.test(event.key)) {
    syncToken();
  }
});
