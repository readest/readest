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
import { isTauriAppPlatform } from '@/services/environment';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import { createGoogleDriveProvider, type FetchFn } from './GoogleDriveProvider';
import { PersistedDriveAuth } from './PersistedDriveAuth';
import { createDriveTokenPersistence } from './driveTokenStore';

/**
 * The official Readest Google OAuth client id (iOS application type), baked into
 * the build. The only runtime client — there is no BYO, because the redirect
 * scheme is derived from this id and registered in the platform manifests at
 * build time. A forker overrides it via the env (and must regenerate the
 * manifest schemes).
 */
export const getGoogleClientId = (): string | undefined =>
  process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] || undefined;

/** Native `fetch` bypasses the WebView CSP for the googleapis.com hosts. */
const resolveFetch = (): FetchFn =>
  (isTauriAppPlatform() ? tauriFetch : globalThis.fetch) as unknown as FetchFn;

export const buildGoogleDriveProvider = async (): Promise<FileSyncProvider | null> => {
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
