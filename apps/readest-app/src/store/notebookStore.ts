import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';
import type { AISelectionContext } from '@/services/ai/types';

export type SelectionContext = AISelectionContext;

export type NotebookTab = 'notes' | 'ai';

interface NotebookState {
  notebookWidth: string;
  isNotebookVisible: boolean;
  isNotebookPinned: boolean;
  notebookActiveTab: NotebookTab;
  notebookNewAnnotation: TextSelection | null;
  // Ids of the highlights eagerly created by the "Annotate" action as the anchor
  // for a note in progress (one per page of a cross-page selection, #5809).
  // Tracked so a cancelled creation flow can tear those empty placeholders back
  // down instead of leaking them (#4791).
  notebookNewHighlightIds: string[];
  notebookEditAnnotation: BookNote | null;
  notebookAnnotationDrafts: { [key: string]: string };
  aiQuestionAnchor: SelectionContext | null;
  aiDraftAttachments: SelectionContext[];
  sourceLocationRequest: SelectionContext | null;
  getIsNotebookVisible: () => boolean;
  toggleNotebook: () => void;
  toggleNotebookPin: () => void;
  getNotebookWidth: () => string;
  setNotebookWidth: (width: string) => void;
  setNotebookVisible: (visible: boolean) => void;
  setNotebookPin: (pinned: boolean) => void;
  setNotebookActiveTab: (tab: NotebookTab) => void;
  setNotebookNewAnnotation: (selection: TextSelection | null) => void;
  setNotebookNewHighlightIds: (ids: string[]) => void;
  setNotebookEditAnnotation: (note: BookNote | null) => void;
  saveNotebookAnnotationDraft: (key: string, note: string) => void;
  getNotebookAnnotationDraft: (key: string) => string | undefined;
  setAIQuestionAnchor: (context: SelectionContext | null) => void;
  addAIDraftAttachment: (context: SelectionContext) => void;
  removeAIDraftAttachment: (id: string) => void;
  clearAISelectionDraft: () => void;
  requestSourceLocation: (context: SelectionContext | null) => void;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebookWidth: '',
  isNotebookVisible: false,
  isNotebookPinned: false,
  notebookActiveTab: 'notes',
  notebookNewAnnotation: null,
  notebookNewHighlightIds: [],
  notebookEditAnnotation: null,
  notebookAnnotationDrafts: {},
  aiQuestionAnchor: null,
  aiDraftAttachments: [],
  sourceLocationRequest: null,
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
  setNotebookNewHighlightIds: (ids: string[]) => set({ notebookNewHighlightIds: ids }),
  setNotebookEditAnnotation: (note: BookNote | null) => set({ notebookEditAnnotation: note }),
  saveNotebookAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      notebookAnnotationDrafts: { ...state.notebookAnnotationDrafts, [key]: note },
    })),
  getNotebookAnnotationDraft: (key: string) => get().notebookAnnotationDrafts[key],
  setAIQuestionAnchor: (context) => set({ aiQuestionAnchor: context }),
  addAIDraftAttachment: (context) =>
    set((state) => ({
      aiDraftAttachments: state.aiDraftAttachments.some((item) => item.id === context.id)
        ? state.aiDraftAttachments
        : [...state.aiDraftAttachments, context],
    })),
  removeAIDraftAttachment: (id) =>
    set((state) => ({
      aiDraftAttachments: state.aiDraftAttachments.filter((item) => item.id !== id),
    })),
  clearAISelectionDraft: () => set({ aiQuestionAnchor: null, aiDraftAttachments: [] }),
  requestSourceLocation: (context) => set({ sourceLocationRequest: context }),
}));
