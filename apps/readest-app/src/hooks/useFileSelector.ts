import { AppService } from '@/types/system';
import { isTauriAppPlatform } from '@/services/environment';
import { invoke } from '@tauri-apps/api/core';
import { basename } from '@tauri-apps/api/path';
import { isContentURI, isFileURI, stubTranslation as _ } from '@/utils/misc';
import { getFilename } from '@/utils/path';
import { eventDispatcher } from '@/utils/event';
import { BOOK_ACCEPT_FORMATS, SUPPORTED_BOOK_EXTS } from '@/services/constants';

export interface FileSelectorOptions {
  type: SelectionType;
  accept?: string;
  multiple?: boolean;
  extensions?: string[];
  dialogTitle?: string;
}

export interface SelectedFile {
  // For Web file
  file?: File;

  // For Tauri file
  path?: string;
  basePath?: string;

  // Resolved display name (with extension). For Tauri `content://` / `file://`
  // URIs the `path` may not carry the filename/extension at all (opaque SAF
  // document ids on some Android devices), so the native content resolver is
  // queried up front and the real DISPLAY_NAME stored here. Consumers that
  // classify by extension (dictionary bundle grouping) must use this, not a
  // naive parse of `path`. See #4489.
  name?: string;
}

export interface FileSelectionResult {
  files: SelectedFile[];
  error?: string;
}

const selectFileWeb = (options: FileSelectorOptions): Promise<File[]> => {
  return new Promise((resolve) => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = options.accept || '*/*';
    fileInput.multiple = options.multiple || false;
    fileInput.click();

    fileInput.onchange = () => {
      resolve(Array.from(fileInput.files || []));
    };
  });
};

/**
 * Resolve the real display name (with extension) for a picked Tauri path.
 *
 * On Android a SAF `content://` URI may be an opaque document id that carries
 * no filename/extension in the URI string at all (varies by device / provider
 * — #4489); on iOS a security-scoped `file://` URI is likewise unreliable.
 * For those we query the native content resolver via `basename` (the same call
 * `AppService.openFile` uses). Plain filesystem paths parse fine with
 * `getFilename`.
 */
export const resolveTauriFileName = async (
  path: string,
  appService: AppService,
): Promise<string> => {
  if (isContentURI(path) || (isFileURI(path) && appService.isIOSApp)) {
    try {
      return await basename(path);
    } catch {
      // Fall through to a best-effort string parse.
    }
  }
  return getFilename(path);
};

const isGamescopeSession = async (): Promise<boolean> => {
  try {
    const [gamescopeDisplay, currentDesktop] = await Promise.all([
      invoke<string>('get_environment_variable', { name: 'GAMESCOPE_WAYLAND_DISPLAY' }),
      invoke<string>('get_environment_variable', { name: 'XDG_CURRENT_DESKTOP' }),
    ]);
    return !!gamescopeDisplay || currentDesktop.toLowerCase().includes('gamescope');
  } catch {
    return false;
  }
};

const selectFileTauri = async (
  options: FileSelectorOptions,
  appService: AppService,
  _: (key: string) => string,
): Promise<SelectedFile[]> => {
  // A gamescope session (SteamOS Gaming Mode) runs no XDG portal backend, so
  // the FileChooser dialog can never appear, and the sandboxed Flatpak relies
  // on that dialog to grant file access — there is no in-app fallback. The
  // failed dialog resolves to null, indistinguishable from a user cancel, so
  // explain up front instead of silently no-oping (#3049).
  if (appService.isLinuxApp && (await isGamescopeSession())) {
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _(
        'The system file picker is not available in Gaming Mode. Please switch to Desktop Mode to select files.',
      ),
      timeout: 5000,
    });
  }
  // Android's SAF picker filters by MIME type. Niche/custom extensions
  // (e.g. ".mrexpt" from Moon+ Reader) have no registered MIME and would
  // appear greyed-out, so for those cases we ask the native side for an
  // unfiltered picker and re-apply the extension whitelist on the
  // resulting paths below. We extend the same treatment to 'generic'
  // selections because callers there typically pass arbitrary extensions
  // that SAF likewise cannot match (e.g. mrexpt, txt).
  //
  // Image selections are the exception on iOS: image extensions all map to
  // real UTTypes, so passing them lets the dialog plugin open the Photos
  // (PHPicker) UI instead of the Files browser — matching Android. Asking for
  // no filter there also made the client-side whitelist below drop anything
  // outside png/jpg/jpeg/gif, so picking a HEIC (the iPhone camera default)
  // silently selected nothing at all.
  const isImageSelection = options.type === 'covers' || options.type === 'images';
  const noFilter =
    (appService?.isIOSApp && !isImageSelection) ||
    (appService?.isAndroidApp &&
      (options.type === 'books' || options.type === 'dictionaries' || options.type === 'generic'));
  const exts = noFilter ? [] : options.extensions || [];
  const title = options.dialogTitle || _('Select Files');
  const paths = (await appService?.selectFiles(_(title), exts)) || [];

  // Resolve the display name once, up front. Both the extension whitelist
  // below and downstream consumers (dictionary bundle grouping) must classify
  // by this resolved name rather than parsing the raw URI — see #4489.
  let files: SelectedFile[] = await Promise.all(
    paths.map(async (path) => ({ path, name: await resolveTauriFileName(path, appService) })),
  );

  if (noFilter && options.extensions) {
    const extensions = options.extensions;
    files = files.filter(({ name }) => {
      const fileExt = name?.split('.').pop()?.toLowerCase() || 'unknown';
      return extensions.includes(fileExt) || extensions.includes('*');
    });
  }

  return files;
};

const processWebFiles = (files: File[]): SelectedFile[] => {
  return files.map((file) => ({
    file,
  }));
};

export const useFileSelector = (appService: AppService | null, _: (key: string) => string) => {
  const selectFiles = async (options: FileSelectorOptions = { type: 'generic' }) => {
    options = { ...FILE_SELECTION_PRESETS[options.type], ...options };
    if (!appService) {
      return { files: [] as SelectedFile[], error: 'App service is not available' };
    }
    try {
      if (isTauriAppPlatform()) {
        const files = await selectFileTauri(options, appService, _);
        return { files };
      } else {
        const webFiles = await selectFileWeb(options);
        const files = processWebFiles(webFiles);
        return { files };
      }
    } catch (error) {
      return {
        files: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  };
  return {
    selectFiles,
  };
};

export const FILE_SELECTION_PRESETS = {
  generic: {
    accept: '*/*',
    extensions: ['*'],
    dialogTitle: _('Select Files'),
  },
  images: {
    accept: 'image/*',
    extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
    dialogTitle: _('Select Image'),
  },
  videos: {
    accept: 'video/*',
    extensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'],
    dialogTitle: _('Select Video'),
  },
  audio: {
    accept: 'audio/*',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'],
    dialogTitle: _('Select Audio'),
  },
  books: {
    accept: BOOK_ACCEPT_FORMATS,
    extensions: SUPPORTED_BOOK_EXTS,
    dialogTitle: _('Select Books'),
  },
  fonts: {
    accept: '.ttf, .otf, .woff, .woff2',
    extensions: ['ttf', 'otf', 'woff', 'woff2'],
    dialogTitle: _('Select Fonts'),
  },
  dictionaries: {
    accept: '.mdx, .mdd, .ifo, .idx, .dict, .dz, .syn, .index, .slob, .bgl, .css',
    extensions: ['mdx', 'mdd', 'ifo', 'idx', 'dict', 'dz', 'syn', 'index', 'slob', 'bgl', 'css'],
    dialogTitle: _('Select Dictionary Files'),
  },
  covers: {
    accept: '.png, .jpg, .jpeg, .gif',
    extensions: ['png', 'jpg', 'jpeg', 'gif'],
    dialogTitle: _('Select Image'),
  },
};

export type SelectionType = keyof typeof FILE_SELECTION_PRESETS;
