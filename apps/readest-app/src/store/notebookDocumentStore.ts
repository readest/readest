import { create } from 'zustand';
import {
  insertNotebookMarkdown,
  validateNotebookMutation,
} from '@/app/reader/utils/notebookDocument';

export type NotebookDocumentStatus =
  | 'clean'
  | 'dirty'
  | 'saving'
  | 'error'
  | 'waiting-for-position'
  | 'recovery-choice';

export type NotebookDocumentError = 'size-limit' | 'recovery-unavailable' | 'save-failed' | null;

export interface NotebookDocumentSession {
  content: string;
  durableContent: string;
  durableUpdatedAt: number | null;
  revision: number;
  savedRevision: number;
  status: NotebookDocumentStatus;
  error: NotebookDocumentError;
  hasEdited: boolean;
  recoveryContent: string | null;
  recoveryAvailable: boolean;
  selectionStart: number;
  selectionEnd: number;
}

interface NotebookMutationOutcome {
  accepted: boolean;
  revision: number;
}

interface NotebookInsertOutcome {
  accepted: boolean;
  insertedStart?: number;
  insertedEnd?: number;
}

interface NotebookDocumentState {
  sessions: Record<string, NotebookDocumentSession>;
  hydrate: (
    bookHash: string,
    durableContent: string,
    durableUpdatedAt: number | null,
    recoveryContent?: string,
  ) => void;
  mutate: (bookHash: string, content: string) => NotebookMutationOutcome;
  insert: (bookHash: string, snippet: string) => NotebookInsertOutcome;
  setSelection: (bookHash: string, start: number, end: number) => void;
  markSaving: (bookHash: string, revision: number) => void;
  markSaved: (
    bookHash: string,
    revision: number,
    durableContent: string,
    durableUpdatedAt: number,
  ) => void;
  markSaveFailed: (bookHash: string, waitingForPosition?: boolean) => void;
  applyRemote: (bookHash: string, content: string, updatedAt: number | null) => void;
  chooseRecovery: (bookHash: string, choice: 'recover' | 'latest') => void;
  markRecoveryAvailable: (bookHash: string, available: boolean) => void;
  discardDraft: (bookHash: string) => void;
  clearSession: (bookHash: string) => void;
  reset: () => void;
}

const createSession = (
  durableContent: string,
  durableUpdatedAt: number | null,
  recoveryContent?: string,
): NotebookDocumentSession => ({
  content: durableContent,
  durableContent,
  durableUpdatedAt,
  revision: 0,
  savedRevision: 0,
  status: recoveryContent === undefined ? 'clean' : 'recovery-choice',
  error: null,
  hasEdited: false,
  recoveryContent: recoveryContent ?? null,
  recoveryAvailable: true,
  selectionStart: durableContent.length,
  selectionEnd: durableContent.length,
});

export const useNotebookDocumentStore = create<NotebookDocumentState>((set, get) => ({
  sessions: {},
  hydrate: (bookHash, durableContent, durableUpdatedAt, recoveryContent) =>
    set((state) => {
      const existing = state.sessions[bookHash];
      if (existing && existing.status !== 'clean') return state;
      const session = createSession(durableContent, durableUpdatedAt, recoveryContent);
      return { sessions: { ...state.sessions, [bookHash]: session } };
    }),
  mutate: (bookHash, content) => {
    const session = get().sessions[bookHash] ?? createSession('', null);
    if (content === session.content) {
      return { accepted: true, revision: session.revision };
    }
    const validation = validateNotebookMutation(session.content, content);
    if (!validation.accepted) {
      set((state) => ({
        sessions: {
          ...state.sessions,
          [bookHash]: { ...session, error: 'size-limit' },
        },
      }));
      return { accepted: false, revision: session.revision };
    }

    const revision = session.revision + 1;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [bookHash]: {
          ...session,
          content,
          revision,
          status: 'dirty',
          error: null,
          hasEdited: true,
          recoveryContent: null,
          selectionStart: Math.min(session.selectionStart, content.length),
          selectionEnd: Math.min(session.selectionEnd, content.length),
        },
      },
    }));
    return { accepted: true, revision };
  },
  insert: (bookHash, snippet) => {
    const session = get().sessions[bookHash] ?? createSession('', null);
    const insertion = insertNotebookMarkdown(
      session.content,
      snippet,
      session.selectionStart,
      session.selectionEnd,
    );
    const outcome = get().mutate(bookHash, insertion.content);
    if (!outcome.accepted) return { accepted: false };
    get().setSelection(bookHash, insertion.insertedStart, insertion.insertedEnd);
    return {
      accepted: true,
      insertedStart: insertion.insertedStart,
      insertedEnd: insertion.insertedEnd,
    };
  },
  setSelection: (bookHash, start, end) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session) return state;
      const selectionStart = Math.max(0, Math.min(start, session.content.length));
      const selectionEnd = Math.max(selectionStart, Math.min(end, session.content.length));
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: { ...session, selectionStart, selectionEnd },
        },
      };
    }),
  markSaving: (bookHash, revision) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session || session.revision !== revision) return state;
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: { ...session, status: 'saving', error: null },
        },
      };
    }),
  markSaved: (bookHash, revision, durableContent, durableUpdatedAt) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session) return state;
      const isLatest = session.revision === revision;
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: {
            ...session,
            durableContent,
            durableUpdatedAt,
            savedRevision: Math.max(session.savedRevision, revision),
            status: isLatest ? 'clean' : 'dirty',
            error: null,
          },
        },
      };
    }),
  markSaveFailed: (bookHash, waitingForPosition = false) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: {
            ...session,
            status: waitingForPosition ? 'waiting-for-position' : 'error',
            error: waitingForPosition ? null : 'save-failed',
          },
        },
      };
    }),
  applyRemote: (bookHash, content, updatedAt) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session) {
        return {
          sessions: { ...state.sessions, [bookHash]: createSession(content, updatedAt) },
        };
      }
      const hasLocalWork = session.revision > session.savedRevision || session.status === 'saving';
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: hasLocalWork
            ? { ...session, durableContent: content, durableUpdatedAt: updatedAt }
            : {
                ...session,
                content,
                durableContent: content,
                durableUpdatedAt: updatedAt,
                selectionStart: Math.min(session.selectionStart, content.length),
                selectionEnd: Math.min(session.selectionEnd, content.length),
                status: 'clean',
                error: null,
              },
        },
      };
    }),
  chooseRecovery: (bookHash, choice) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session || session.recoveryContent === null) return state;
      if (choice === 'latest') {
        return {
          sessions: {
            ...state.sessions,
            [bookHash]: { ...session, recoveryContent: null, status: 'clean' },
          },
        };
      }
      const revision = session.revision + 1;
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: {
            ...session,
            content: session.recoveryContent,
            recoveryContent: null,
            revision,
            status: 'dirty',
            hasEdited: true,
            selectionStart: session.recoveryContent.length,
            selectionEnd: session.recoveryContent.length,
          },
        },
      };
    }),
  markRecoveryAvailable: (bookHash, recoveryAvailable) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session || session.recoveryAvailable === recoveryAvailable) return state;
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: { ...session, recoveryAvailable },
        },
      };
    }),
  discardDraft: (bookHash) =>
    set((state) => {
      const session = state.sessions[bookHash];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [bookHash]: {
            ...session,
            content: session.durableContent,
            revision: session.savedRevision,
            status: 'clean',
            error: null,
            recoveryContent: null,
            selectionStart: session.durableContent.length,
            selectionEnd: session.durableContent.length,
          },
        },
      };
    }),
  clearSession: (bookHash) =>
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[bookHash];
      return { sessions };
    }),
  reset: () => set({ sessions: {} }),
}));
