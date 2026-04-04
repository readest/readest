import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { AIConversation, AIMessage } from '@/services/ai/types';

// Mock the aiStore (IndexedDB-backed persistence)
const mockGetConversations = vi.fn<(bookHash: string) => Promise<AIConversation[]>>();
const mockGetMessages = vi.fn<(id: string) => Promise<AIMessage[]>>();
const mockSaveConversation = vi.fn<(conv: AIConversation) => Promise<void>>();
const mockSaveMessage = vi.fn<(msg: AIMessage) => Promise<void>>();
const mockDeleteConversation = vi.fn<(id: string) => Promise<void>>();
const mockUpdateConversationTitle = vi.fn<(id: string, title: string) => Promise<void>>();

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    getConversations: (...args: Parameters<typeof mockGetConversations>) =>
      mockGetConversations(...args),
    getMessages: (...args: Parameters<typeof mockGetMessages>) => mockGetMessages(...args),
    saveConversation: (...args: Parameters<typeof mockSaveConversation>) =>
      mockSaveConversation(...args),
    saveMessage: (...args: Parameters<typeof mockSaveMessage>) => mockSaveMessage(...args),
    deleteConversation: (...args: Parameters<typeof mockDeleteConversation>) =>
      mockDeleteConversation(...args),
    updateConversationTitle: (...args: Parameters<typeof mockUpdateConversationTitle>) =>
      mockUpdateConversationTitle(...args),
  },
}));

import { useAIChatStore } from '@/store/aiChatStore';

beforeEach(() => {
  vi.clearAllMocks();
  useAIChatStore.setState({
    activeConversationId: null,
    conversations: [],
    messages: [],
    isLoadingHistory: false,
    currentBookHash: null,
  });
});

describe('aiChatStore', () => {
  // ── Initial state ──────────────────────────────────────────────
  describe('initial state', () => {
    test('has correct defaults', () => {
      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.conversations).toEqual([]);
      expect(state.messages).toEqual([]);
      expect(state.isLoadingHistory).toBe(false);
      expect(state.currentBookHash).toBeNull();
    });
  });

  // ── loadConversations ──────────────────────────────────────────
  describe('loadConversations', () => {
    test('loads conversations for a book hash', async () => {
      const convs: AIConversation[] = [
        { id: 'c1', bookHash: 'book1', title: 'Conv 1', createdAt: 100, updatedAt: 200 },
      ];
      mockGetConversations.mockResolvedValue(convs);

      await useAIChatStore.getState().loadConversations('book1');

      const state = useAIChatStore.getState();
      expect(state.conversations).toEqual(convs);
      expect(state.currentBookHash).toBe('book1');
      expect(state.isLoadingHistory).toBe(false);
      expect(mockGetConversations).toHaveBeenCalledWith('book1');
    });

    test('skips loading when same bookHash and conversations already exist', async () => {
      const convs: AIConversation[] = [
        { id: 'c1', bookHash: 'book1', title: 'Conv 1', createdAt: 100, updatedAt: 200 },
      ];
      useAIChatStore.setState({ currentBookHash: 'book1', conversations: convs });

      await useAIChatStore.getState().loadConversations('book1');

      expect(mockGetConversations).not.toHaveBeenCalled();
    });

    test('reloads when bookHash differs', async () => {
      const oldConvs: AIConversation[] = [
        { id: 'c1', bookHash: 'book1', title: 'Conv 1', createdAt: 100, updatedAt: 200 },
      ];
      useAIChatStore.setState({ currentBookHash: 'book1', conversations: oldConvs });

      const newConvs: AIConversation[] = [
        { id: 'c2', bookHash: 'book2', title: 'Conv 2', createdAt: 300, updatedAt: 400 },
      ];
      mockGetConversations.mockResolvedValue(newConvs);

      await useAIChatStore.getState().loadConversations('book2');

      expect(useAIChatStore.getState().conversations).toEqual(newConvs);
      expect(useAIChatStore.getState().currentBookHash).toBe('book2');
    });

    test('handles errors gracefully', async () => {
      mockGetConversations.mockRejectedValue(new Error('DB error'));

      await useAIChatStore.getState().loadConversations('book1');

      const state = useAIChatStore.getState();
      expect(state.isLoadingHistory).toBe(false);
      expect(state.conversations).toEqual([]);
    });
  });

  // ── setActiveConversation ──────────────────────────────────────
  describe('setActiveConversation', () => {
    test('sets null to clear active conversation', async () => {
      useAIChatStore.setState({
        activeConversationId: 'c1',
        messages: [{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hi', createdAt: 100 }],
      });

      await useAIChatStore.getState().setActiveConversation(null);

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });

    test('loads messages for a conversation id', async () => {
      const msgs: AIMessage[] = [
        { id: 'm1', conversationId: 'c1', role: 'user', content: 'hello', createdAt: 100 },
        { id: 'm2', conversationId: 'c1', role: 'assistant', content: 'hi', createdAt: 200 },
      ];
      mockGetMessages.mockResolvedValue(msgs);

      await useAIChatStore.getState().setActiveConversation('c1');

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBe('c1');
      expect(state.messages).toEqual(msgs);
      expect(state.isLoadingHistory).toBe(false);
    });

    test('handles error when loading messages', async () => {
      mockGetMessages.mockRejectedValue(new Error('DB error'));

      await useAIChatStore.getState().setActiveConversation('c1');

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBe('c1');
      expect(state.messages).toEqual([]);
      expect(state.isLoadingHistory).toBe(false);
    });
  });

  // ── createConversation ─────────────────────────────────────────
  describe('createConversation', () => {
    test('creates a conversation and returns its id', async () => {
      mockSaveConversation.mockResolvedValue(undefined);
      mockGetConversations.mockResolvedValue([]);

      const id = await useAIChatStore.getState().createConversation('book1', 'Test Title');

      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(mockSaveConversation).toHaveBeenCalledTimes(1);

      const savedConv = mockSaveConversation.mock.calls[0]![0];
      expect(savedConv.bookHash).toBe('book1');
      expect(savedConv.title).toBe('Test Title');
      expect(savedConv.id).toBe(id);
    });

    test('truncates title to 50 characters', async () => {
      mockSaveConversation.mockResolvedValue(undefined);
      mockGetConversations.mockResolvedValue([]);

      const longTitle = 'A'.repeat(100);
      await useAIChatStore.getState().createConversation('book1', longTitle);

      const savedConv = mockSaveConversation.mock.calls[0]![0];
      expect(savedConv.title).toBe('A'.repeat(50));
    });

    test('uses default title when empty string provided', async () => {
      mockSaveConversation.mockResolvedValue(undefined);
      mockGetConversations.mockResolvedValue([]);

      await useAIChatStore.getState().createConversation('book1', '');

      const savedConv = mockSaveConversation.mock.calls[0]![0];
      expect(savedConv.title).toBe('New conversation');
    });

    test('sets the created conversation as active with empty messages', async () => {
      mockSaveConversation.mockResolvedValue(undefined);
      const convs: AIConversation[] = [
        { id: 'x', bookHash: 'book1', title: 'X', createdAt: 1, updatedAt: 1 },
      ];
      mockGetConversations.mockResolvedValue(convs);

      const id = await useAIChatStore.getState().createConversation('book1', 'New');

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBe(id);
      expect(state.messages).toEqual([]);
      expect(state.currentBookHash).toBe('book1');
      expect(state.conversations).toEqual(convs);
    });
  });

  // ── addMessage ─────────────────────────────────────────────────
  describe('addMessage', () => {
    test('adds a message to current state', async () => {
      mockSaveMessage.mockResolvedValue(undefined);
      mockSaveConversation.mockResolvedValue(undefined);

      useAIChatStore.setState({
        activeConversationId: 'c1',
        currentBookHash: 'book1',
        conversations: [
          { id: 'c1', bookHash: 'book1', title: 'Conv', createdAt: 100, updatedAt: 100 },
        ],
        messages: [],
      });

      await useAIChatStore.getState().addMessage({
        conversationId: 'c1',
        role: 'user',
        content: 'Hello',
      });

      const state = useAIChatStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]!.content).toBe('Hello');
      expect(state.messages[0]!.role).toBe('user');
      expect(state.messages[0]!.conversationId).toBe('c1');
      expect(typeof state.messages[0]!.id).toBe('string');
      expect(typeof state.messages[0]!.createdAt).toBe('number');
    });

    test('saves message to persistent store', async () => {
      mockSaveMessage.mockResolvedValue(undefined);
      mockSaveConversation.mockResolvedValue(undefined);

      useAIChatStore.setState({
        activeConversationId: 'c1',
        currentBookHash: 'book1',
        conversations: [
          { id: 'c1', bookHash: 'book1', title: 'Conv', createdAt: 100, updatedAt: 100 },
        ],
      });

      await useAIChatStore.getState().addMessage({
        conversationId: 'c1',
        role: 'assistant',
        content: 'Response',
      });

      expect(mockSaveMessage).toHaveBeenCalledTimes(1);
      const savedMsg = mockSaveMessage.mock.calls[0]![0];
      expect(savedMsg.content).toBe('Response');
      expect(savedMsg.role).toBe('assistant');
    });

    test('updates conversation updatedAt when active conversation matches', async () => {
      mockSaveMessage.mockResolvedValue(undefined);
      mockSaveConversation.mockResolvedValue(undefined);

      const conv: AIConversation = {
        id: 'c1',
        bookHash: 'book1',
        title: 'Conv',
        createdAt: 100,
        updatedAt: 100,
      };
      useAIChatStore.setState({
        activeConversationId: 'c1',
        currentBookHash: 'book1',
        conversations: [conv],
      });

      await useAIChatStore.getState().addMessage({
        conversationId: 'c1',
        role: 'user',
        content: 'msg',
      });

      expect(mockSaveConversation).toHaveBeenCalledTimes(1);
    });

    test('does not update conversation when no active conversation', async () => {
      mockSaveMessage.mockResolvedValue(undefined);

      useAIChatStore.setState({
        activeConversationId: null,
        currentBookHash: null,
        conversations: [],
      });

      await useAIChatStore.getState().addMessage({
        conversationId: 'c1',
        role: 'user',
        content: 'msg',
      });

      expect(mockSaveConversation).not.toHaveBeenCalled();
    });

    test('appends multiple messages sequentially', async () => {
      mockSaveMessage.mockResolvedValue(undefined);
      mockSaveConversation.mockResolvedValue(undefined);

      useAIChatStore.setState({
        activeConversationId: 'c1',
        currentBookHash: 'book1',
        conversations: [
          { id: 'c1', bookHash: 'book1', title: 'Conv', createdAt: 100, updatedAt: 100 },
        ],
        messages: [],
      });

      await useAIChatStore.getState().addMessage({
        conversationId: 'c1',
        role: 'user',
        content: 'First',
      });
      await useAIChatStore.getState().addMessage({
        conversationId: 'c1',
        role: 'assistant',
        content: 'Second',
      });

      const state = useAIChatStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]!.content).toBe('First');
      expect(state.messages[1]!.content).toBe('Second');
    });
  });

  // ── deleteConversation ─────────────────────────────────────────
  describe('deleteConversation', () => {
    test('deletes conversation and clears active if it was active', async () => {
      mockDeleteConversation.mockResolvedValue(undefined);
      mockGetConversations.mockResolvedValue([]);

      useAIChatStore.setState({
        activeConversationId: 'c1',
        currentBookHash: 'book1',
        conversations: [
          { id: 'c1', bookHash: 'book1', title: 'Conv', createdAt: 100, updatedAt: 200 },
        ],
        messages: [{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hi', createdAt: 100 }],
      });

      await useAIChatStore.getState().deleteConversation('c1');

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.messages).toEqual([]);
      expect(mockDeleteConversation).toHaveBeenCalledWith('c1');
    });

    test('deletes conversation without clearing active if different one is active', async () => {
      mockDeleteConversation.mockResolvedValue(undefined);
      const remainingConvs: AIConversation[] = [
        { id: 'c2', bookHash: 'book1', title: 'Conv 2', createdAt: 100, updatedAt: 200 },
      ];
      mockGetConversations.mockResolvedValue(remainingConvs);

      useAIChatStore.setState({
        activeConversationId: 'c2',
        currentBookHash: 'book1',
        conversations: [
          { id: 'c1', bookHash: 'book1', title: 'Conv 1', createdAt: 100, updatedAt: 200 },
          { id: 'c2', bookHash: 'book1', title: 'Conv 2', createdAt: 100, updatedAt: 200 },
        ],
        messages: [{ id: 'm1', conversationId: 'c2', role: 'user', content: 'hi', createdAt: 100 }],
      });

      await useAIChatStore.getState().deleteConversation('c1');

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBe('c2');
      expect(state.messages).toHaveLength(1);
      expect(state.conversations).toEqual(remainingConvs);
    });

    test('does not reload conversations when currentBookHash is null', async () => {
      mockDeleteConversation.mockResolvedValue(undefined);

      useAIChatStore.setState({
        activeConversationId: 'c1',
        currentBookHash: null,
        conversations: [],
      });

      await useAIChatStore.getState().deleteConversation('c1');

      expect(mockGetConversations).not.toHaveBeenCalled();
    });
  });

  // ── renameConversation ─────────────────────────────────────────
  describe('renameConversation', () => {
    test('renames a conversation and reloads list', async () => {
      mockUpdateConversationTitle.mockResolvedValue(undefined);
      const updated: AIConversation[] = [
        { id: 'c1', bookHash: 'book1', title: 'New Title', createdAt: 100, updatedAt: 300 },
      ];
      mockGetConversations.mockResolvedValue(updated);

      useAIChatStore.setState({
        currentBookHash: 'book1',
        conversations: [
          { id: 'c1', bookHash: 'book1', title: 'Old Title', createdAt: 100, updatedAt: 200 },
        ],
      });

      await useAIChatStore.getState().renameConversation('c1', 'New Title');

      expect(mockUpdateConversationTitle).toHaveBeenCalledWith('c1', 'New Title');
      expect(useAIChatStore.getState().conversations).toEqual(updated);
    });

    test('does not reload when currentBookHash is null', async () => {
      mockUpdateConversationTitle.mockResolvedValue(undefined);

      useAIChatStore.setState({ currentBookHash: null });

      await useAIChatStore.getState().renameConversation('c1', 'New Title');

      expect(mockGetConversations).not.toHaveBeenCalled();
    });
  });

  // ── clearActiveConversation ────────────────────────────────────
  describe('clearActiveConversation', () => {
    test('clears active conversation id and messages', () => {
      useAIChatStore.setState({
        activeConversationId: 'c1',
        messages: [{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hi', createdAt: 100 }],
      });

      useAIChatStore.getState().clearActiveConversation();

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });

    test('is a no-op when already cleared', () => {
      useAIChatStore.setState({ activeConversationId: null, messages: [] });

      useAIChatStore.getState().clearActiveConversation();

      const state = useAIChatStore.getState();
      expect(state.activeConversationId).toBeNull();
      expect(state.messages).toEqual([]);
    });
  });
});
