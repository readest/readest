import { create } from 'zustand';

import { BookContent, BookConfig, PageInfo, BookProgress, ViewSettings } from '@/types/book';
import { EnvConfigType } from '@/services/environment';
import { FoliateView } from '@/types/view';
import { BookDoc, DocumentLoader, SectionItem, TOCItem } from '@/libs/document';
import { updateTocCFI, updateTocID } from '@/utils/toc';
import { useSettingsStore } from './settingsStore';
import { useBookDataStore } from './bookDataStore';
import { useLibraryStore } from './libraryStore';

interface ViewState {
  /* Unique key for each book view */
  key: string;
  view: FoliateView | null;
  isPrimary: boolean;
  loading: boolean;
  error: string | null;
  progress: BookProgress | null;
  ribbonVisible: boolean;
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

  setProgress: (
    key: string,
    location: string,
    tocItem: TOCItem,
    section: PageInfo,
    pageinfo: PageInfo,
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
  ) => Promise<void>;
  clearViewState: (key: string) => void;
  getViewState: (key: string) => ViewState | null;
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
      .filter((state) => state.key.startsWith(id))
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
  initViewState: async (envConfig: EnvConfigType, id: string, key: string, isPrimary = true) => {
    const booksData = useBookDataStore.getState().booksData;
    const bookData = booksData[id];
    set((state) => ({
      viewStates: {
        ...state.viewStates,
        [key]: {
          key: '',
          view: null,
          isPrimary: false,
          loading: true,
          error: null,
          progress: null,
          ribbonVisible: false,
          viewSettings: null,
        },
      },
    }));
    try {
      if (!bookData) {
        const appService = await envConfig.getAppService();
        const { settings } = useSettingsStore.getState();
        const { library } = useLibraryStore.getState();
        const book = library.find((b) => b.hash === id);
        if (!book) {
          throw new Error('Book not found');
        }
        const content = (await appService.loadBookContent(book, settings)) as BookContent;
        const { file, config } = content;
        console.log('Loading book', key);
        const { book: loadedBookDoc } = await new DocumentLoader(file).open();
        const bookDoc = loadedBookDoc as BookDoc;
        if (bookDoc.toc?.length && bookDoc.sections?.length) {
          updateTocID(bookDoc.toc);
          const sections = bookDoc.sections.reduce((map: Record<string, SectionItem>, section) => {
            map[section.id] = section;
            return map;
          }, {});
          updateTocCFI(bookDoc, bookDoc.toc, sections);
        }
        useBookDataStore.setState((state) => ({
          booksData: {
            ...state.booksData,
            [id]: { id, book, file, config, bookDoc },
          },
        }));
      }
      const booksData = useBookDataStore.getState().booksData;
      const config = booksData[id]?.config as BookConfig;
      const configViewSettings = config.viewSettings!;
      set((state) => ({
        viewStates: {
          ...state.viewStates,
          [key]: {
            ...state.viewStates[key],
            key,
            view: null,
            isPrimary,
            loading: false,
            error: null,
            progress: null,
            ribbonVisible: false,
            viewSettings: JSON.parse(JSON.stringify(configViewSettings)) as ViewSettings,
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
            isPrimary: false,
            loading: false,
            error: 'Failed to load book.',
            progress: null,
            ribbonVisible: false,
            viewSettings: null,
          },
        },
      }));
    }
  },
  getViewSettings: (key: string) => get().viewStates[key]?.viewSettings || null,
  setViewSettings: (key: string, viewSettings: ViewSettings) => {
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
    range: Range,
  ) =>
    set((state) => {
      const id = key.split('-')[0]!;
      const bookData = useBookDataStore.getState().booksData[id];
      const viewState = state.viewStates[key];
      if (!viewState || !bookData) return state;

      const progress: [number, number] = [(pageinfo.next ?? pageinfo.current) + 1, pageinfo.total];

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
        updatedAt: Date.now(),
        progress,
        location,
      };

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
}));
