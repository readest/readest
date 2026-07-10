/** Google Drive's slot in the shared keychain token store. */
import {
  createKeychainTokenPersistence,
  type TokenPersistence,
} from '@/services/sync/providers/oauth/keychainTokenStore';

export type { TokenPersistence };
export const DRIVE_TOKEN_KEY = 'gdrive_token_set';

export const createDriveTokenPersistence = (): Promise<TokenPersistence | null> =>
  createKeychainTokenPersistence(DRIVE_TOKEN_KEY, 'Google Drive');
