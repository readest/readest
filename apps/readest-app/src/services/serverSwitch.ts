import type { Book } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { AppService } from '@/types/system';
import {
  type StoredServerConfig,
  clearStoredServerConfig,
  writeStoredServerConfig,
} from '@/services/serverConfig';

/**
 * The library as it should look against a server that has never seen it:
 * books with a file on this device stay and read as not uploaded; entries
 * that only existed in the old server's cloud have nothing behind them here
 * and are dropped (switching back pulls them again, the cursors start at 0).
 */
export const resetLibraryForServerSwitch = (books: Book[]): Book[] =>
  books
    .filter((book) => !(book.uploadedAt && !book.downloadedAt))
    .map((book) => ({ ...book, uploadedAt: null, syncedAt: null }));

/** Readest Cloud sync starts over against the new server. */
export const resetSettingsForServerSwitch = (settings: SystemSettings): SystemSettings => ({
  ...settings,
  lastSyncedAtBooks: 0,
  lastSyncedAtConfigs: 0,
  lastSyncedAtNotes: 0,
  lastSyncedAtReplicas: {},
});

/**
 * Switches the server the app talks to (`null` = Readest Cloud). Every
 * destructive step runs against the old server first; writing the stored
 * server is the commit point, so a switch interrupted before it leaves the
 * old server active with nothing from the new one mixed in. The reload makes
 * every module that read the config at import time pick up the new one.
 */
export const switchServer = async ({
  appService,
  logout,
  next,
  reload = () => window.location.reload(),
}: {
  appService: AppService;
  logout: () => void | Promise<void>;
  next: StoredServerConfig | null;
  reload?: () => void;
}): Promise<void> => {
  await logout();
  const books = await appService.loadLibraryBooks();
  await appService.saveLibraryBooks(resetLibraryForServerSwitch(books), { replace: true });
  const settings = await appService.loadSettings();
  await appService.saveSettings(resetSettingsForServerSwitch(settings));
  if (next) {
    writeStoredServerConfig(next);
  } else {
    clearStoredServerConfig();
  }
  reload();
};
