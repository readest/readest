/**
 * Assemble a ready-to-use OneDrive {@link FileSyncProvider} from the pieces built
 * in this folder: the env-baked OAuth client id, a CSP-bypassing native `fetch`,
 * the keychain token store, and the single-flight {@link createOneDriveAuth}.
 * Mirrors `gdrive/buildGoogleDriveProvider.ts`.
 *
 * Returns `null` when OneDrive cannot run here — no client id baked into the
 * build, or no secure token storage (a Tauri keychain that failed to probe).
 * Callers treat `null` as "this backend is unavailable" rather than surfacing a
 * half-built provider that would fail on first use.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { createOneDriveProvider, type FetchFn } from './OneDriveProvider';
import { createOneDriveAuth } from './onedriveAuth';
import { createOneDriveTokenPersistence } from './onedriveTokenStore';
import { webOneDriveTokenPersistence } from './webAuthCodeFlow';

/**
 * Official Readest Microsoft (Azure) app registration client id, baked into the
 * build so OneDrive sync works out of the box. One public client serves every
 * platform (native custom-scheme redirect + web SPA redirect). Not a secret — it
 * ships inside the app binary, like the Google client id. A forker overrides it
 * via `NEXT_PUBLIC_MICROSOFT_CLIENT_ID` at build (and must register their own
 * redirect URIs on that client).
 */
const OFFICIAL_MICROSOFT_CLIENT_ID = '99ebebbc-a44b-40fc-b418-aade0f28900c';

export const getMicrosoftClientId = (): string | undefined =>
  process.env['NEXT_PUBLIC_MICROSOFT_CLIENT_ID'] || OFFICIAL_MICROSOFT_CLIENT_ID || undefined;

/** Native `fetch` bypasses the WebView CSP for the graph.microsoft.com host. */
const resolveFetch = (): FetchFn =>
  (isTauriAppPlatform() ? tauriFetch : globalThis.fetch) as unknown as FetchFn;

export const buildOneDriveProvider = async (): Promise<FileSyncProvider | null> => {
  // Web: token from the full-page redirect auth-code+PKCE flow, kept in
  // sessionStorage via the shared `PersistedOAuth` (webOneDriveTokenPersistence).
  // Buffered I/O (createOneDriveProvider omits the Tauri-only streaming methods
  // off-Tauri); the Graph REST API is CORS-enabled so plain fetch works.
  if (isWebAppPlatform()) {
    const clientId = getMicrosoftClientId();
    if (!clientId) return null;
    // Bind to the global so `this.fetchFn(...)` inside the provider doesn't call
    // window.fetch with the wrong receiver ("Illegal invocation").
    const fetchFn = globalThis.fetch.bind(globalThis) as unknown as FetchFn;
    return createOneDriveProvider(
      createOneDriveAuth({ clientId, fetchFn, persistence: webOneDriveTokenPersistence }),
      fetchFn,
    );
  }
  const clientId = getMicrosoftClientId();
  if (!clientId) return null;
  // No ephemeral fallback for the refresh token: if secure storage is missing,
  // OneDrive is simply not available here.
  const persistence = await createOneDriveTokenPersistence();
  if (!persistence) return null;
  const fetchFn = resolveFetch();
  const auth = createOneDriveAuth({ clientId, fetchFn, persistence });
  return createOneDriveProvider(auth, fetchFn);
};
