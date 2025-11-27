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

  toggleAIChat: () => void;
  setAIChatVisible: (visible: boolean) => void;
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

  toggleAIChat: () => set((state) => ({ isAIChatVisible: !state.isAIChatVisible })),
  setAIChatVisible: (visible) => set({ isAIChatVisible: visible }),
  toggleAIChatPin: () => set((state) => ({ isAIChatPinned: !state.isAIChatPinned })),
  setAIChatWidth: (width) => set({ aiChatWidth: width }),
  setActiveSnippet: (snippet) => set({ activeSnippet: snippet }),
  setCurrentConversationId: (id) => set({ currentConversationId: id }),
  setConversations: (conversations) => set({ conversations }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  addMessage: async (conversationId, message) => {
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

  createConversation: async (conversation) => {
    if (!chatService) return;
    await chatService.addConversation(conversation);
    const conversations = await chatService.loadConversations();
    set({ conversations, currentConversationId: conversation.id });
  },

  loadConversations: async (appService) => {
    if (!chatService) chatService = new AIChatService(appService);
    const conversations = await chatService.loadConversations();
    set({ conversations });
  },

  startSpeechConversation: (conversationId) => {
    set({ isSpeechModeActive: true, currentConversationId: conversationId });
  },

  stopSpeechConversation: () => {
    set({ isSpeechModeActive: false, isRecording: false });
  },

  setRecording: (recording) => set({ isRecording: recording }),
}));
