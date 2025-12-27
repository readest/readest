import { create } from 'zustand';

import {
  BookContent,
  BookConfig,
  PageInfo,
  BookProgress,
  ViewSettings,
  TimeInfo,
  FIXED_LAYOUT_FORMATS,
} from '@/types/book';
import { Insets } from '@/types/misc';
import { EnvConfigType } from '@/services/environment';
import { FoliateView } from '@/types/view';
import { DocumentLoader, TOCItem } from '@/libs/document';
import { updateToc } from '@/utils/toc';
import { formatTitle, getMetadataHash, getPrimaryLanguage } from '@/utils/book';
import { getBaseFilename } from '@/utils/path';
import { SUPPORTED_LANGNAMES } from '@/services/constants';
import { useSettingsStore } from './settingsStore';
import { useBookDataStore } from './bookDataStore';
import { useLibraryStore } from './libraryStore';
import { uniqueId } from '@/utils/misc';

interface ViewState {
  /* Unique key for each book view */
  key: string;
  view: FoliateView | null;
  viewerKey: string;
  isPrimary: boolean;
  loading: boolean;
  inited: boolean;
  error: string | null;
  progress: BookProgress | null;
  ribbonVisible: boolean;
  ttsEnabled: boolean;
  syncing: boolean;
  gridInsets: Insets | null;
  /* View settings for the view: 
    generally view settings have a hierarchy of global settings < book settings < view settings
    view settings for primary view are saved to book config which is persisted to config file
    omitting settings that are not changed from global settings */
  viewSettings: ViewSettings | null;
}

interface ReaderStore {
  viewStates: { [key: string]: ViewState };
  bookKeys: string[];
  hoveredBookKey: string | null;
  setBookKeys: (keys: string[]) => void;
  setHoveredBookKey: (key: string | null) => void;
  setBookmarkRibbonVisibility: (key: string, visible: boolean) => void;
  setTTSEnabled: (key: string, enabled: boolean) => void;
  setIsSyncing: (key: string, syncing: boolean) => void;
  setProgress: (
    key: string,
    location: string,
    tocItem: TOCItem,
    section: PageInfo,
    pageinfo: PageInfo,
    timeinfo: TimeInfo,
    range: Range,
  ) => void;
  getProgress: (key: string) => BookProgress | null;
  setView: (key: string, view: FoliateView) => void;
  getView: (key: string | null) => FoliateView | null;
  getViews: () => FoliateView[];
  getViewsById: (id: string) => FoliateView[];
  setViewSettings: (key: string, viewSettings: ViewSettings) => void;
  getViewSettings: (key: string) => ViewSettings | null;

  initViewState: (
    envConfig: EnvConfigType,
    id: string,
    key: string,
    isPrimary?: boolean,
    reload?: boolean,
  ) => Promise<void>;
  clearViewState: (key: string) => void;
  getViewState: (key: string) => ViewState | null;
  getGridInsets: (key: string) => Insets | null;
  setGridInsets: (key: string, insets: Insets | null) => void;
  setViewInited: (key: string, inited: boolean) => void;
  recreateViewer: (envConfig: EnvConfigType, key: string) => void;
}

export const useReaderStore = create<ReaderStore>((set, get) => ({
  viewStates: {},
  bookKeys: [],
  hoveredBookKey: null,
  setBookKeys: (keys: string[]) => set({ bookKeys: keys }),
  setHoveredBookKey: (key: string | null) => set({ hoveredBookKey: key }),
  getView: (key: string | null) => (key && get().viewStates[key]?.view) || null,
  setView: (key: string, view) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: { ...state.viewStates[key]!, view },
      },
    })),
  getViews: () => Object.values(get().viewStates).map((state) => state.view!),
  getViewsById: (id: string) => {
    const { viewStates } = get();
    return Object.values(viewStates)
      .filter((state) => state.key && state.key.startsWith(id))
      .map((state) => state.view!);
  },

  clearViewState: (key: string) => {
    set((state) => {
      const viewStates = { ...state.viewStates };
      delete viewStates[key];
      return { viewStates };
    });
  },
  getViewState: (key: string) => get().viewStates[key] || null,
  initViewState: async (
    envConfig: EnvConfigType,
    id: string,
    key: string,
    isPrimary = true,
    reload = false,
  ) => {
    const booksData = useBookDataStore.getState().booksData;
    const bookData = booksData[id];
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          key: '',
          view: null,
          viewerKey: '',
          isPrimary: false,
          loading: true,
          inited: false,
          error: null,
          progress: null,
          ribbonVisible: false,
          ttsEnabled: false,
          syncing: false,
          gridInsets: null,
          viewSettings: null,
        },
      },
    }));
    try {
      const appService = await envConfig.getAppService();
      const { settings } = useSettingsStore.getState();
      const { library } = useLibraryStore.getState();
      const book = library.find((b) => b.hash === id);
      if (!book) {
        throw new Error('Book not found');
      }
      let bookDoc = bookData?.bookDoc;
      let file = bookData?.file;
      if (!bookDoc || !file || reload) {
        const content = (await appService.loadBookContent(book)) as BookContent;
        file = content.file;
        console.log('Loading book', key);
        const doc = await new DocumentLoader(file).open();
        bookDoc = doc.book;
      }
      const config = await appService.loadBookConfig(book, settings);
      await updateToc(
        bookDoc,
        config.viewSettings?.sortedTOC ?? false,
        config.viewSettings?.convertChineseVariant ?? 'none',
      );
      if (!bookDoc.metadata.title) {
        bookDoc.metadata.title = getBaseFilename(file.name);
      }
      book.sourceTitle = formatTitle(bookDoc.metadata.title);
      // Correct language codes mistakenly set with language names
      if (typeof bookDoc.metadata?.language === 'string') {
        if (bookDoc.metadata.language in SUPPORTED_LANGNAMES) {
          bookDoc.metadata.language = SUPPORTED_LANGNAMES[bookDoc.metadata.language]!;
        }
      }
      // Set the book's language for formerly imported books, newly imported books have this field set
      const primaryLanguage = getPrimaryLanguage(bookDoc.metadata.language);
      book.primaryLanguage = book.primaryLanguage ?? primaryLanguage;
      book.metadata = book.metadata ?? bookDoc.metadata;
      // TODO: uncomment this when we can ensure metaHash is correctly generated for all books
      // book.metaHash = book.metaHash ?? getMetadataHash(bookDoc.metadata);
      book.metaHash = getMetadataHash(bookDoc.metadata);

      const isFixedLayout = FIXED_LAYOUT_FORMATS.has(book.format);
      useBookDataStore.setState((state) => ({
        booksData: {
          ...state.booksData,
          [id]: { id, book, file, config, bookDoc, isFixedLayout },
        },
      }));
      const configViewSettings = config.viewSettings!;
      const globalViewSettings = settings.globalViewSettings;
      set((state) => ({
        viewStates: {
          ...state.viewStates,
          [key]: {
            ...state.viewStates[key],
            key,
            view: null,
            viewerKey: `${key}-${uniqueId()}`,
            isPrimary,
            loading: false,
            inited: false,
            error: null,
            progress: null,
            ribbonVisible: false,
            ttsEnabled: false,
            syncing: false,
            gridInsets: null,
            viewSettings: { ...globalViewSettings, ...configViewSettings },
          },
        },
      }));
    } catch (error) {
      console.error(error);
      set((state) => ({
        viewStates: {
          ...state.viewStates,
          [key]: {
            ...state.viewStates[key],
            key: '',
            view: null,
            viewerKey: '',
            isPrimary: false,
            loading: false,
            inited: false,
            error: 'Failed to load book.',
            progress: null,
            ribbonVisible: false,
            ttsEnabled: false,
            syncing: false,
            gridInsets: null,
            viewSettings: null,
          },
        },
      }));
      throw error;
    }
  },
  getViewSettings: (key: string) => get().viewStates[key]?.viewSettings || null,
  setViewSettings: (key: string, viewSettings: ViewSettings) => {
    if (!key) return;
    const id = key.split('-')[0]!;
    const bookData = useBookDataStore.getState().booksData[id];
    const viewState = get().viewStates[key];
    if (!viewState || !bookData) return;
    if (viewState.isPrimary) {
      useBookDataStore.setState((state) => ({
        booksData: {
          ...state.booksData,
          [id]: {
            ...bookData,
            config: {
              ...bookData.config,
              updatedAt: Date.now(),
              viewSettings,
            },
          },
        },
      }));
    }
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          viewSettings,
        },
      },
    }));
  },
  getProgress: (key: string) => get().viewStates[key]?.progress || null,
  setProgress: (
    key: string,
    location: string,
    tocItem: TOCItem,
    section: PageInfo,
    pageinfo: PageInfo,
    timeinfo: TimeInfo,
    range: Range,
  ) =>
    set((state) => {
      const id = key.split('-')[0]!;
      const bookData = useBookDataStore.getState().booksData[id];
      const viewState = state.viewStates[key];
      if (!viewState || !bookData) return state;

      const pagePressInfo = bookData.isFixedLayout ? section : pageinfo;
      const progress: [number, number] = [pagePressInfo.current + 1, pagePressInfo.total];

      // Update library book progress
      const { library, setLibrary } = useLibraryStore.getState();
      const bookIndex = library.findIndex((b) => b.hash === id);
      if (bookIndex !== -1) {
        const updatedLibrary = [...library];
        const existingBook = updatedLibrary[bookIndex]!;
        updatedLibrary[bookIndex] = {
          ...existingBook,
          progress,
          updatedAt: Date.now(),
        };
        setLibrary(updatedLibrary);
      }

      const oldConfig = bookData.config;
      const newConfig = {
        ...bookData.config,
        progress,
        location,
      } as BookConfig;

      useBookDataStore.setState((state) => ({
        booksData: {
          ...state.booksData,
          [id]: {
            ...bookData,
            config: viewState.isPrimary ? newConfig : oldConfig,
          },
        },
      }));

      return {
        viewStates: {
          ...state.viewStates,
          [key]: {
            ...viewState,
            progress: {
              ...viewState.progress,
              location,
              sectionHref: tocItem?.href,
              sectionLabel: tocItem?.label,
              sectionId: tocItem?.id,
              section,
              pageinfo,
              timeinfo,
              range,
            },
          },
        },
      };
    }),
  setBookmarkRibbonVisibility: (key: string, visible: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          ribbonVisible: visible,
        },
      },
    })),

  setTTSEnabled: (key: string, enabled: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          ttsEnabled: enabled,
        },
      },
    })),

  setIsSyncing: (key: string, syncing: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          syncing,
        },
      },
    })),

  getGridInsets: (key: string) =>
    get().viewStates[key]?.gridInsets || { top: 0, right: 0, bottom: 0, left: 0 },
  setGridInsets: (key: string, insets: Insets | null) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          gridInsets: insets,
        },
      },
    })),

  setViewInited: (key: string, inited: boolean) =>
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          ...state.viewStates[key]!,
          inited,
        },
      },
    })),

  recreateViewer: (envConfig: EnvConfigType, key: string) => {
    const id = key.split('-')[0]!;
    get()
      .initViewState(envConfig, id, key, true, true)
      .then(() => {
        set((state) => ({
          viewStates: {
            ...state.viewStates,
            [key]: {
              ...state.viewStates[key]!,
              viewerKey: `${key}-${uniqueId()}`,
            },
          },
        }));
      });
  },
}));
