import { describe, expect, test, vi } from 'vitest';
import {
  appendSelectionContext,
  createAIThreadHistoryAdapter,
  selectionPayloadFromRunConfig,
  selectionPayloadToRunConfig,
} from '@/services/ai/storage/threadHistoryAdapter';
import type { AISelectionPayload } from '@/services/ai/types';

const selection: AISelectionPayload = {
  questionAnchor: {
    id: 'anchor-1',
    bookKey: 'book-0',
    text: 'selected PDF text',
    page: 2,
    index: 1,
    cfi: 'epubcfi(/6/4!/4/2:0,/1:0,/1:10)',
  },
  attachments: [],
};

const userItem = (runConfig = selectionPayloadToRunConfig(selection)) =>
  ({
    message: {
      id: 'message-1',
      role: 'user',
      content: [{ type: 'text', text: '请解释这段内容' }],
      attachments: [],
      createdAt: new Date(),
      metadata: { custom: {} },
    },
    parentId: null,
    runConfig,
  }) as never;

describe('AI thread history adapter', () => {
  test('round-trips and appends selected PDF context', () => {
    const runConfig = selectionPayloadToRunConfig(selection);

    expect(selectionPayloadFromRunConfig(runConfig)).toEqual(selection);
    expect(appendSelectionContext('问题', selection)).toContain('selected PDF text');
    expect(appendSelectionContext('问题', selection)).toContain('page: 2');
  });

  test('creates an anchored conversation for the first selected question', async () => {
    const createConversation = vi.fn().mockResolvedValue('conversation-1');
    const addMessage = vi.fn().mockResolvedValue(undefined);
    const rememberMessageSelection = vi.fn();
    const adapter = createAIThreadHistoryAdapter({
      bookHash: 'book',
      bookTitle: '论文',
      getActiveConversationId: () => null,
      getStoredMessages: () => [],
      createConversation,
      addMessage,
      rememberMessageSelection,
    });

    await adapter.append?.(userItem());

    expect(createConversation).toHaveBeenCalledWith(
      'book',
      '请解释这段内容',
      selection.questionAnchor,
      false,
    );
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        role: 'user',
        selection,
      }),
    );
    expect(rememberMessageSelection).toHaveBeenCalledWith('message-1', selection);
  });
});
