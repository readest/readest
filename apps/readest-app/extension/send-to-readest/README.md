# Send to Readest — browser extension

One-click capture of the current web page into your Readest library.

## How it works

1. A content script on `web.readest.com` copies the signed-in Supabase access
   token into the extension's local storage (no credentials are stored by the
   extension itself).
2. The popup's **Send this page** button POSTs the active tab's URL to
   `POST /api/send/inbox` with that token.
3. The URL lands in the user's `send_inbox`; the next Readest client to sync
   drains it — fetching the article, converting it to EPUB, and adding it to
   the library.

## Load it for development

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `send-to-readest/` directory.
3. Sign in at <https://web.readest.com> once so the token is captured.
4. Click the extension icon on any page.

## Before publishing to the Chrome Web Store

- Add `icons` (16/32/48/128 px) to `manifest.json`.
- Replace the localStorage token bridge with a proper OAuth flow
  (`chrome.identity.launchWebAuthFlow`) if the Supabase token format changes.
- Submit through the Chrome Web Store Developer Dashboard (review required).
