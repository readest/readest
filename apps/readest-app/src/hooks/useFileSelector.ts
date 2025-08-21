import { AppService } from '@/types/system';
import { isTauriAppPlatform } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { BOOK_ACCEPT_FORMATS, SUPPORTED_BOOK_EXTS } from '@/services/constants';

export interface FileSelectorOptions {
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

const selectFileTauri = async (
  options: FileSelectorOptions,
  appService: AppService,
  _: (key: string) => string,
): Promise<string[]> => {
  const exts = appService?.isIOSApp ? [] : options.extensions || [];
  const title = options.dialogTitle || _('Select Files');
  const files = (await appService?.selectFiles(_(title), exts)) || [];

  if (appService?.isIOSApp && options.extensions) {
    return files.filter((file: string) => {
      const fileExt = file.split('.').pop()?.toLowerCase() || 'unknown';
      return options.extensions!.includes(fileExt);
    });
  }

  return files;
};

const processWebFiles = (files: File[]): SelectedFile[] => {
  return files.map((file) => ({
    file,
  }));
};

const processTauriFiles = (files: string[]): SelectedFile[] => {
  return files.map((path) => ({
    path,
  }));
};

export const useFileSelector = (appService: AppService | null, _: (key: string) => string) => {
  const selectFiles = async (options: FileSelectorOptions = {}) => {
    if (!appService) {
      return { files: [], error: 'App service is not available' };
    }
    try {
      if (isTauriAppPlatform()) {
        const filePaths = await selectFileTauri(options, appService, _);
        const files = await processTauriFiles(filePaths);
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
};
