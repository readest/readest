// Runs on web.readest.com. Readest stores its Supabase session in
// localStorage; copy the access token into extension storage so the popup can
// authenticate to /api/send/inbox without the extension holding credentials.
(function () {
  function findAccessToken() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && /^sb-.*-auth-token$/.test(key)) {
        try {
          const value = JSON.parse(localStorage.getItem(key));
          if (value && value.access_token) return value.access_token;
        } catch {
          /* ignore malformed entries */
        }
      }
    }
    return null;
  }

  const token = findAccessToken();
  if (token) {
    chrome.storage.local.set({ readestAccessToken: token, readestTokenAt: Date.now() });
  }
})();
