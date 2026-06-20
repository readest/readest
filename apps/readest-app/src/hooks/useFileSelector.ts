import { AppService } from '@/types/system';
import { isTauriAppPlatform } from '@/services/environment';
import { basename } from '@tauri-apps/api/path';
import { isContentURI, isFileURI, stubTranslation as _ } from '@/utils/misc';
import { getFilename } from '@/utils/path';
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
const resolveTauriFileName = async (path: string, appService: AppService): Promise<string> => {
  if (isContentURI(path) || (isFileURI(path) && appService.isIOSApp)) {
    try {
      return await basename(path);
    } catch {
      // Fall through to a best-effort string parse.
    }
  }
  return getFilename(path);
};

const selectFileTauri = async (
  options: FileSelectorOptions,
  appService: AppService,
  _: (key: string) => string,
): Promise<SelectedFile[]> => {
  // Android's SAF picker filters by MIME type. Niche/custom extensions
  // (e.g. ".mrexpt" from Moon+ Reader) have no registered MIME and would
  // appear greyed-out, so for those cases we ask the native side for an
  // unfiltered picker and re-apply the extension whitelist on the
  // resulting paths below. We extend the same treatment to 'generic'
  // selections because callers there typically pass arbitrary extensions
  // that SAF likewise cannot match (e.g. mrexpt, txt).
  const noFilter =
    appService?.isIOSApp ||
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
    accept: '.mdx, .mdd, .ifo, .idx, .dict, .dz, .syn, .index, .slob, .css',
    extensions: ['mdx', 'mdd', 'ifo', 'idx', 'dict', 'dz', 'syn', 'index', 'slob', 'css'],
    dialogTitle: _('Select Dictionary Files'),
  },
  covers: {
    accept: '.png, .jpg, .jpeg, .gif',
    extensions: ['png', 'jpg', 'jpeg', 'gif'],
    dialogTitle: _('Select Image'),
  },
};

export type SelectionType = keyof typeof FILE_SELECTION_PRESETS;
