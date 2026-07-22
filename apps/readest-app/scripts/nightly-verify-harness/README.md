# Nightly updater — local verification harness

Exercises the in-app nightly check (Tier 2 detection) and the signature gate
(Tier 4) on a desktop `pnpm tauri dev` build, without waiting on CI.

Throwaway-signed fixtures only (the signing key was discarded).

## What it can and can't prove
- ✅ **Detection (Tier 2)** — the app on the nightly channel fetches both
  manifests, applies the comparator, offers the right version; the isolated check
  never calls Tauri `check()`; error / up-to-date states render.
- ✅ **Verify-gate REJECT (Tier 4)** — a bad/garbage signature is refused.
- ✅ **Resolver decision (no GUI)** — the unit test `resolveNightlyUpdate —
  harness scenarios` in `src/__tests__/helpers/updater.test.ts` runs the real
  resolver against these manifest builders (`pnpm test src/__tests__/helpers/updater.test.ts`).
- ⚠️ **Full install / accept-valid** — needs the **real** signing key (CI only):
  the app verifies against the production `READEST_UPDATER_PUBKEY`, so the
  throwaway artifact correctly fails real-key verification if you click
  "Download & Install". Accept-valid is covered by the Rust test
  `pnpm test:rust` → `nightly_update::tests::verify_accepts_valid_signature`.
- On **macOS** the install path routes through Tauri's updater (darwin key), so
  the custom verify-gate isn't hit from the UI — use the Tier 4 devtools snippet
  below (or the Rust test) to exercise it directly.

## Tier 2 — live detection

1. Start the server:
   ```bash
   pnpm verify:nightly          # or: node scripts/nightly-verify-harness/serve.mjs
   ```
2. Point the two manifest constants at the server. In
   `src/services/constants.ts` temporarily change:
   ```ts
   export const READEST_NIGHTLY_UPDATER_FILE = 'http://127.0.0.1:8788/nightly/latest.json';
   // and
   export const READEST_UPDATER_FILE = 'http://127.0.0.1:8788/releases/latest.json';
   ```
   (The app's HTTP capability already allows `http://*:*`, so localhost works.)
3. Run and opt in:
   ```bash
   pnpm tauri dev
   ```
   Settings → toggle **Nightly Builds (Unstable)** → About → **Check Update**.
   - Expect: **"Nightly · <base> (Jan 1, 2099, 00:00)"** is available.
   - Server log shows `GET /nightly/latest.json` **and** `/releases/latest.json`
     (both fetched, then filtered/compared).
   - **Error state:** stop the server (Ctrl-C), re-run Check Update → expect
     "Failed to check for updates", not a blank pane.
4. **Cross-channel:** point `READEST_UPDATER_FILE` at
   `http://127.0.0.1:8788/releases/latest-surpass.json` (stable = base, patch +1).
   The offered version should switch to the **stable** `<base+1>` — a higher-base
   stable beats the nightly. Switch back and the nightly wins again.
5. **Revert the constants** when done:
   ```bash
   git checkout src/services/constants.ts
   ```

## Tier 4 — verify-gate, directly (any platform)

In the dev window devtools console (right-click → Inspect):

```js
const path = '<ABS>/apps/readest-app/scripts/nightly-verify-harness/artifacts/test.bin';
const pubKey = 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEZFQTAxMjIzNUEwRkE0OUIKUldTYnBBOWFJeEtnL2x4Q3dKR3dSWVJCY3dLNXdCR1l4d1YyVkhaZUppOVVNVm1kOGprbU85bTMK';
const goodSig = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTYnBBOWFJeEtnL3RvRC83dEJEUXZONVFZM1hranhKTUZxQzllR2lGWnNjckZMbCtOa3RXMi80aFdDYUNDUkdOa0NqUjJUQkZDL2dqaUVTeURlNzI0cW1BcUlZY2ZsOGcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzgxNDE0MzExCWZpbGU6bnYuYmluCkQzajlpbVZPOXVDYXdna2JBVWZ0TTE4K1d1cWdEYWVYQzVraGh4U1ZuOGNSTDZaOU5zV093OEVDajBvV0JydVV5VGY2K0tkb0hBbGJHYWprK0NsNUN3PT0K';
const { invoke } = window.__TAURI_INTERNALS__;

await invoke('verify_update_signature', { path, signature: goodSig, pubKey });        // → true
await invoke('verify_update_signature', { path, signature: 'AAAAgarbage', pubKey });  // → false
```
Replace `<ABS>`. (`pubKey` is the *throwaway* key that signed `test.bin`, not the
production key.) Tampering `test.bin` and re-running the good-sig call also → false.

## Notes
- Nightly is stamped `<base>-2099010100` so it's always newer than installed.
- `serve.mjs` reads the base version from `package.json` each request, so it stays
  correct as the app version changes.
