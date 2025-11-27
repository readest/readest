import { create } from 'zustand';
import { AIConversation, AIChatMessage, AIChatService } from '@/services/aiChatService';
import { AppService } from '@/types/system';

export interface ActiveSnippet {
  text: string;
  type: 'highlight' | 'page' | 'chapter';
  bookKey: string;
  bookTitle: string;
  bookAuthor: string;
}

interface AIChatState {
  aiChatWidth: string;
  isAIChatVisible: boolean;
  isAIChatPinned: boolean;
  currentConversationId: string | null;
  conversations: AIConversation[];
  activeSnippet: ActiveSnippet | null;
  isLoading: boolean;
  error: string | null;
  isSpeechModeActive: boolean;
  isRecording: boolean;
  speechConversationId: string | null;

  // Getters
  getIsAIChatVisible: () => boolean;
  getAIChatWidth: () => string;
  getCurrentConversation: () => AIConversation | null;

  // Actions
  toggleAIChat: () => void;
  setAIChatVisible: (visible: boolean) => void;
  setAIChatPin: (pinned: boolean) => void;
  toggleAIChatPin: () => void;
  setAIChatWidth: (width: string) => void;
  setActiveSnippet: (snippet: ActiveSnippet | null) => void;
  setCurrentConversationId: (id: string | null) => void;
  setConversations: (conversations: AIConversation[]) => void;
  addMessage: (conversationId: string, message: AIChatMessage) => Promise<void>;
  createConversation: (conversation: AIConversation) => Promise<void>;
  loadConversations: (appService: AppService) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  startSpeechConversation: (conversationId: string) => void;
  stopSpeechConversation: () => void;
  setRecording: (recording: boolean) => void;
}

let chatService: AIChatService | null = null;

export const useAIChatStore = create<AIChatState>((set, get) => ({
  aiChatWidth: '30%',
  isAIChatVisible: false,
  isAIChatPinned: false,
  currentConversationId: null,
  conversations: [],
  activeSnippet: null,
  isLoading: false,
  error: null,
  isSpeechModeActive: false,
  isRecording: false,
  speechConversationId: null,

  getIsAIChatVisible: () => get().isAIChatVisible,
  getAIChatWidth: () => get().aiChatWidth,
  getCurrentConversation: () => {
    const { currentConversationId, conversations } = get();
    if (!currentConversationId) return null;
    return conversations.find((c) => c.id === currentConversationId) || null;
  },

  toggleAIChat: () => set((state) => ({ isAIChatVisible: !state.isAIChatVisible })),
  setAIChatVisible: (visible: boolean) => set({ isAIChatVisible: visible }),
  setAIChatPin: (pinned: boolean) => set({ isAIChatPinned: pinned }),
  toggleAIChatPin: () => set((state) => ({ isAIChatPinned: !state.isAIChatPinned })),
  setAIChatWidth: (width: string) => set({ aiChatWidth: width }),
  setActiveSnippet: (snippet: ActiveSnippet | null) => set({ activeSnippet: snippet }),
  setCurrentConversationId: (id: string | null) => set({ currentConversationId: id }),
  setConversations: (conversations: AIConversation[]) => set({ conversations }),
  setLoading: (loading: boolean) => set({ isLoading: loading }),
  setError: (error: string | null) => set({ error }),

  addMessage: async (conversationId: string, message: AIChatMessage) => {
    if (!chatService) return;

    const { conversations } = get();
    const conversation = conversations.find((c) => c.id === conversationId);
    if (!conversation) return;

    conversation.messages.push(message);
    conversation.updatedAt = Date.now();

    await chatService.updateConversation(conversationId, {
      messages: conversation.messages,
      updatedAt: conversation.updatedAt,
    });

    set({ conversations: [...conversations] });
  },

  createConversation: async (conversation: AIConversation) => {
    if (!chatService) return;

    await chatService.addConversation(conversation);
    const conversations = await chatService.loadConversations();
    set({
      conversations,
      currentConversationId: conversation.id,
    });
  },

  loadConversations: async (appService: AppService) => {
    if (!chatService) {
      chatService = new AIChatService(appService);
    }
    const conversations = await chatService.loadConversations();
    set({ conversations });
  },

  startSpeechConversation: (conversationId: string) => {
    set({
      isSpeechModeActive: true,
      speechConversationId: conversationId,
      currentConversationId: conversationId,
    });
  },

  stopSpeechConversation: () => {
    set({
      isSpeechModeActive: false,
      isRecording: false,
      speechConversationId: null,
    });
  },

  setRecording: (recording: boolean) => {
    set({ isRecording: recording });
  },
}));

