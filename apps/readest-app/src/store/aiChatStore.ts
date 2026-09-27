import { create } from 'zustand';
import { AIConversation, AIMessage, AISelectionContext } from '@/services/ai/types';
import { aiStore } from '@/services/ai/storage/aiStore';

interface AIChatState {
  activeConversationId: string | null;
  conversations: AIConversation[];
  messages: AIMessage[];
  isLoadingHistory: boolean;
  currentBookHash: string | null;

  loadConversations: (bookHash: string) => Promise<void>;
  setActiveConversation: (id: string | null) => Promise<void>;
  createConversation: (
    bookHash: string,
    title: string,
    anchor?: AISelectionContext | null,
    activate?: boolean,
  ) => Promise<string>;
  addMessage: (message: Omit<AIMessage, 'id' | 'createdAt'>) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  clearActiveConversation: () => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useAIChatStore = create<AIChatState>((set, get) => ({
  activeConversationId: null,
  conversations: [],
  messages: [],
  isLoadingHistory: false,
  currentBookHash: null,

  loadConversations: async (bookHash: string) => {
    if (get().currentBookHash === bookHash && get().conversations.length > 0) {
      return;
    }
    set({ isLoadingHistory: true });
    try {
      const conversations = await aiStore.getConversations(bookHash);
      set({
        conversations,
        currentBookHash: bookHash,
        isLoadingHistory: false,
      });
    } catch {
      set({ isLoadingHistory: false });
    }
  },

  setActiveConversation: async (id: string | null) => {
    if (id === null) {
      set({ activeConversationId: null, messages: [] });
      return;
    }
    set({ isLoadingHistory: true });
    try {
      const messages = await aiStore.getMessages(id);
      set({
        activeConversationId: id,
        messages,
        isLoadingHistory: false,
      });
    } catch {
      set({ activeConversationId: id, messages: [], isLoadingHistory: false });
    }
  },

  createConversation: async (bookHash, title, anchor = null, activate = true) => {
    const id = generateId();
    const now = Date.now();
    const conversation: AIConversation = {
      id,
      bookHash,
      title: title.slice(0, 50) || 'New conversation',
      ...(anchor ? { anchor } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await aiStore.saveConversation(conversation);
    const conversations = await aiStore.getConversations(bookHash);
    set({
      conversations,
      currentBookHash: bookHash,
      ...(activate ? { activeConversationId: id, messages: [] } : {}),
    });
    return id;
  },

  addMessage: async (message: Omit<AIMessage, 'id' | 'createdAt'>) => {
    const id = generateId();
    const fullMessage: AIMessage = {
      ...message,
      id,
      createdAt: Date.now(),
    };
    await aiStore.saveMessage(fullMessage);

    // update conversation updatedAt
    const { activeConversationId, currentBookHash } = get();
    if (currentBookHash) {
      const conversations = get().conversations;
      const conv = conversations.find((c) => c.id === message.conversationId);
      if (conv) {
        await aiStore.saveConversation({ ...conv, updatedAt: Date.now() });
      }
    }

    if (activeConversationId === message.conversationId) {
      set((state) => ({
        messages: [...state.messages, fullMessage],
      }));
    }
  },

  deleteConversation: async (id: string) => {
    const { currentBookHash, activeConversationId } = get();
    await aiStore.deleteConversation(id);

    if (currentBookHash) {
      const conversations = await aiStore.getConversations(currentBookHash);
      set({
        conversations,
        ...(activeConversationId === id ? { activeConversationId: null, messages: [] } : {}),
      });
    }
  },

  renameConversation: async (id: string, title: string) => {
    const { currentBookHash } = get();
    await aiStore.updateConversationTitle(id, title);

    if (currentBookHash) {
      const conversations = await aiStore.getConversations(currentBookHash);
      set({ conversations });
    }
  },

  clearActiveConversation: () => {
    set({ activeConversationId: null, messages: [] });
  },
}));
