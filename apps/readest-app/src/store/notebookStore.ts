import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

interface NotebookState {
  notebookWidth: string;
  isNotebookVisible: boolean;
  isNotebookPinned: boolean;
  notebookNewAnnotation: TextSelection | null;
  notebookEditAnnotation: BookNote | null;
  notebookAnnotationDrafts: { [key: string]: string };
  toggleNotebook: () => void;
  toggleNotebookPin: () => void;
  setNotebookWidth: (width: string) => void;
  setNotebookVisible: (visible: boolean) => void;
  setNotebookPin: (pinned: boolean) => void;
  setNotebookNewAnnotation: (selection: TextSelection | null) => void;
  setNotebookEditAnnotation: (note: BookNote | null) => void;
  saveNotebookAnnotationDraft: (key: string, note: string) => void;
  getNotebookAnnotationDraft: (key: string) => string | undefined;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebookWidth: '',
  isNotebookVisible: false,
  isNotebookPinned: false,
  notebookNewAnnotation: null,
  notebookEditAnnotation: null,
  notebookAnnotationDrafts: {},
  setNotebookWidth: (width: string) => set({ notebookWidth: width }),
  toggleNotebook: () => set((state) => ({ isNotebookVisible: !state.isNotebookVisible })),
  toggleNotebookPin: () => set((state) => ({ isNotebookPinned: !state.isNotebookPinned })),
  setNotebookVisible: (visible: boolean) => set({ isNotebookVisible: visible }),
  setNotebookPin: (pinned: boolean) => set({ isNotebookPinned: pinned }),
  setNotebookNewAnnotation: (selection: TextSelection | null) =>
    set({ notebookNewAnnotation: selection }),
  setNotebookEditAnnotation: (note: BookNote | null) => set({ notebookEditAnnotation: note }),
  saveNotebookAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      notebookAnnotationDrafts: { ...state.notebookAnnotationDrafts, [key]: note },
    })),
  getNotebookAnnotationDraft: (key: string) => get().notebookAnnotationDrafts[key],
}));
