/** OneDrive's slot in the shared keychain token store. */
import {
  createKeychainTokenPersistence,
  type TokenPersistence,
} from '@/services/sync/providers/oauth/keychainTokenStore';

export type { TokenPersistence };
export const ONEDRIVE_TOKEN_KEY = 'onedrive_token_set';

export const createOneDriveTokenPersistence = (): Promise<TokenPersistence | null> =>
  createKeychainTokenPersistence(ONEDRIVE_TOKEN_KEY, 'OneDrive');
