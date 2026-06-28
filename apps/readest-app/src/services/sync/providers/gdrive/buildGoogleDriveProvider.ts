/**
 * Assemble a ready-to-use Google Drive {@link FileSyncProvider} from the pieces
 * built in this folder: the env-baked OAuth client id, a CSP-bypassing native
 * `fetch`, the keychain token store, and the single-flight {@link PersistedDriveAuth}.
 *
 * Returns `null` when Drive cannot run here — no client id baked into the build,
 * or no secure token storage (web, or a Tauri keychain that failed to probe).
 * Callers treat `null` as "this backend is unavailable" rather than surfacing a
 * half-built provider that would fail on first use.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { createGoogleDriveProvider, type FetchFn } from './GoogleDriveProvider';
import { PersistedDriveAuth } from './PersistedDriveAuth';
import { WebDriveAuth } from './WebDriveAuth';
import { createDriveTokenPersistence } from './driveTokenStore';

/**
 * The official Readest Google OAuth client id (iOS application type, no secret),
 * baked into the build so Drive sync works for every user out of the box. The
 * only runtime client — there is no BYO, because the redirect scheme is derived
 * from this id and registered in the platform manifests at build time (the
 * `com.googleusercontent.apps.<id>` schemes in `tauri.conf.json`). A forker
 * overrides it via `NEXT_PUBLIC_GOOGLE_CLIENT_ID` at build (and must regenerate
 * the manifest schemes to match). The client id is NOT a secret — it ships
 * inside the app binary.
 */
const OFFICIAL_GOOGLE_CLIENT_ID =
  '209390247301-ctpmep68ppfa56r1b8tr35e4qi4p60kq.apps.googleusercontent.com';

export const getGoogleClientId = (): string | undefined =>
  process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] || OFFICIAL_GOOGLE_CLIENT_ID;

/**
 * The official Readest **Web-type** Google OAuth client id used by the browser
 * GIS flow (its authorized JavaScript origins are `web.readest.com` + the
 * localhost dev origin). Separate from the iOS-type
 * {@link OFFICIAL_GOOGLE_CLIENT_ID}, which can't drive a browser token client.
 * Not a secret — it ships in the web bundle. A forker overrides it via
 * `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` and must register their own deploy origin
 * on that client.
 */
const OFFICIAL_GOOGLE_WEB_CLIENT_ID =
  '209390247301-585tc3dohg4c02588uvah5d32hg6dneq.apps.googleusercontent.com';

export const getGoogleWebClientId = (): string | undefined =>
  process.env['NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID'] || OFFICIAL_GOOGLE_WEB_CLIENT_ID;

/** Native `fetch` bypasses the WebView CSP for the googleapis.com hosts. */
const resolveFetch = (): FetchFn =>
  (isTauriAppPlatform() ? tauriFetch : globalThis.fetch) as unknown as FetchFn;

export const buildGoogleDriveProvider = async (): Promise<FileSyncProvider | null> => {
  // Web: token from the full-page redirect flow, kept in sessionStorage, read by
  // WebDriveAuth. Buffered I/O (createGoogleDriveProvider omits the Tauri-only
  // streaming methods off-Tauri); the Drive REST API is CORS-enabled so plain
  // fetch works. No keychain.
  if (isWebAppPlatform()) {
    if (!getGoogleWebClientId()) return null;
    // Bind to the global so `this.fetchFn(...)` inside the provider doesn't call
    // window.fetch with the wrong receiver ("Illegal invocation").
    const fetchFn = globalThis.fetch.bind(globalThis) as unknown as FetchFn;
    return createGoogleDriveProvider(new WebDriveAuth(fetchFn), fetchFn);
  }

  const clientId = getGoogleClientId();
  if (!clientId) return null;

  // No ephemeral fallback for the refresh token: if secure storage is missing,
  // Drive is simply not available here.
  const persistence = await createDriveTokenPersistence();
  if (!persistence) return null;

  const fetchFn = resolveFetch();
  const auth = new PersistedDriveAuth({ clientId, fetchFn, persistence });
  return createGoogleDriveProvider(auth, fetchFn);
};
