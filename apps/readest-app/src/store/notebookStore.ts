import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

export type NotebookTab = 'notes' | 'ai';

interface NotebookState {
  notebookWidth: string;
  isNotebookVisible: boolean;
  isNotebookPinned: boolean;
  notebookActiveTab: NotebookTab;
  notebookNewAnnotation: TextSelection | null;
  // Id of the highlight eagerly created by the "Annotate" action as the anchor
  // for a note in progress. Tracked so a cancelled creation flow can tear that
  // empty placeholder back down instead of leaking it (#4791).
  notebookNewHighlightId: string | null;
  notebookEditAnnotation: BookNote | null;
  notebookAnnotationDrafts: { [key: string]: string };
  getIsNotebookVisible: () => boolean;
  toggleNotebook: () => void;
  toggleNotebookPin: () => void;
  getNotebookWidth: () => string;
  setNotebookWidth: (width: string) => void;
  setNotebookVisible: (visible: boolean) => void;
  setNotebookPin: (pinned: boolean) => void;
  setNotebookActiveTab: (tab: NotebookTab) => void;
  setNotebookNewAnnotation: (selection: TextSelection | null) => void;
  setNotebookNewHighlightId: (id: string | null) => void;
  setNotebookEditAnnotation: (note: BookNote | null) => void;
  saveNotebookAnnotationDraft: (key: string, note: string) => void;
  getNotebookAnnotationDraft: (key: string) => string | undefined;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebookWidth: '',
  isNotebookVisible: false,
  isNotebookPinned: false,
  notebookActiveTab: 'notes',
  notebookNewAnnotation: null,
  notebookNewHighlightId: null,
  notebookEditAnnotation: null,
  notebookAnnotationDrafts: {},
  getIsNotebookVisible: () => get().isNotebookVisible,
  getNotebookWidth: () => get().notebookWidth,
  setNotebookWidth: (width: string) => set({ notebookWidth: width }),
  toggleNotebook: () => set((state) => ({ isNotebookVisible: !state.isNotebookVisible })),
  toggleNotebookPin: () => set((state) => ({ isNotebookPinned: !state.isNotebookPinned })),
  setNotebookVisible: (visible: boolean) => set({ isNotebookVisible: visible }),
  setNotebookPin: (pinned: boolean) => set({ isNotebookPinned: pinned }),
  setNotebookActiveTab: (tab: NotebookTab) => set({ notebookActiveTab: tab }),
  setNotebookNewAnnotation: (selection: TextSelection | null) =>
    set({ notebookNewAnnotation: selection }),
  setNotebookNewHighlightId: (id: string | null) => set({ notebookNewHighlightId: id }),
  setNotebookEditAnnotation: (note: BookNote | null) => set({ notebookEditAnnotation: note }),
  saveNotebookAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      notebookAnnotationDrafts: { ...state.notebookAnnotationDrafts, [key]: note },
    })),
  getNotebookAnnotationDraft: (key: string) => get().notebookAnnotationDrafts[key],
}));
