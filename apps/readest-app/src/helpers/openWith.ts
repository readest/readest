import { isWebAppPlatform, hasCli } from '@/services/environment';
import { AppService } from '@/types/system';
import { getCurrent } from '@tauri-apps/plugin-deep-link';

declare global {
  interface Window {
    OPEN_WITH_FILES?: string[] | null;
  }
}

interface CliArgument {
  value: string;
  occurrences: number;
}

const parseWindowOpenWithFiles = () => {
  const params = new URLSearchParams(window.location.search);
  const files = params.getAll('file');
  return files.length > 0 ? files : window.OPEN_WITH_FILES;
};

const parseCLIOpenWithFiles = async () => {
  const { getMatches } = await import('@tauri-apps/plugin-cli');
  let matches;
  try {
    matches = await getMatches();
  } catch (err) {
    // getMatches() rejects when argv carries an option the file-only CLI schema
    // does not define. sentry-minidump relaunches the app with
    // `--crash-reporter-server`, which the parser rejects (READEST-Y). Treat a
    // parse failure as "no CLI files" instead of leaking an unhandled rejection.
    console.warn('Failed to parse CLI open-with args', err);
    return [];
  }
  const args = matches?.args;
  const files: string[] = [];
  if (args) {
    for (const name of ['file1', 'file2', 'file3', 'file4']) {
      const arg = args[name] as CliArgument;
      if (arg && arg.occurrences > 0) {
        files.push(arg.value);
      }
    }
  }

  return files;
};

const parseIntentOpenWithFiles = async (appService: AppService | null) => {
  const urls = await getCurrent();
  if (urls && urls.length > 0) {
    console.log('Intent Open with URL:', urls);
    return urls
      .map((url) => {
        if (url.startsWith('file://')) {
          if (appService?.isIOSApp) {
            return decodeURI(url);
          } else {
            return decodeURI(url.replace('file://', ''));
          }
        } else if (url.startsWith('content://')) {
          return url;
        } else {
          console.info('Skip non-file URL:', url);
          return null;
        }
      })
      .filter((url) => url !== null) as string[];
  }
  return null;
};

/**
 * Decide whether an "Open with" file intent should open as a transient book
 * (straight to the reader, no library write) or be imported into the library.
 *
 * Only Android's `VIEW` intent (the system "Open with Readest" chooser) can be
 * transient, and only when the user has turned off "Auto Import on File Open".
 * Every other case — a share-sheet `SEND` capture, or `VIEW` with auto-import
 * on — imports the file so it persists in the library (and syncs to the cloud
 * on mobile).
 */
export const shouldOpenTransient = (
  action: 'VIEW' | 'SEND' | undefined,
  autoImportBooksOnOpen: boolean,
): boolean => {
  return action === 'VIEW' && !autoImportBooksOnOpen;
};

export const parseOpenWithFiles = async (appService: AppService | null) => {
  if (isWebAppPlatform()) return [];

  let files = parseWindowOpenWithFiles();
  if ((!files || files.length === 0) && hasCli()) {
    files = await parseCLIOpenWithFiles();
  }
  if (!files || files.length === 0) {
    files = await parseIntentOpenWithFiles(appService);
  }
  return files;
};
