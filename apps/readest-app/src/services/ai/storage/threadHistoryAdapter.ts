import type {
  ExportedMessageRepositoryItem,
  ThreadHistoryAdapter,
  ThreadMessage,
} from '@assistant-ui/react';
import type { AIMessage, AISelectionContext, AISelectionPayload } from '../types';

const SELECTION_CONFIG_KEY = 'readestSelection';

interface SelectionRunConfig {
  custom?: Record<string, unknown>;
}

interface ThreadHistoryDependencies {
  bookHash: string;
  bookTitle: string;
  getActiveConversationId: () => string | null;
  getStoredMessages: () => AIMessage[];
  createConversation: (
    bookHash: string,
    title: string,
    anchor?: AISelectionContext | null,
    activate?: boolean,
  ) => Promise<string>;
  addMessage: (message: Omit<AIMessage, 'id' | 'createdAt'>) => Promise<void>;
  activateConversation?: (id: string) => Promise<void>;
  rememberMessageSelection?: (messageId: string, selection: AISelectionPayload) => void;
}

const isSelectionContext = (value: unknown): value is AISelectionContext => {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<AISelectionContext>;
  return (
    typeof context.id === 'string' &&
    typeof context.bookKey === 'string' &&
    typeof context.text === 'string' &&
    typeof context.page === 'number' &&
    typeof context.index === 'number'
  );
};

const isSelectionPayload = (value: unknown): value is AISelectionPayload => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<AISelectionPayload>;
  return (
    (payload.questionAnchor === null || isSelectionContext(payload.questionAnchor)) &&
    Array.isArray(payload.attachments) &&
    payload.attachments.every(isSelectionContext)
  );
};

export const selectionPayloadToRunConfig = (selection: AISelectionPayload): SelectionRunConfig => ({
  custom: { [SELECTION_CONFIG_KEY]: selection },
});

export const selectionPayloadFromRunConfig = (
  runConfig: SelectionRunConfig | undefined,
): AISelectionPayload | undefined => {
  const value = runConfig?.custom?.[SELECTION_CONFIG_KEY];
  return isSelectionPayload(value) ? value : undefined;
};

export const selectionPayloadFromMessage = (
  message: ThreadMessage,
): AISelectionPayload | undefined => {
  const value = message.metadata?.custom?.[SELECTION_CONFIG_KEY];
  return isSelectionPayload(value) ? value : undefined;
};

export const formatSelectionContext = (context: AISelectionContext) =>
  [
    '<selection-context>',
    `page: ${context.page}`,
    `section: ${context.index}`,
    context.cfi ? `cfi: ${context.cfi}` : null,
    context.href ? `href: ${context.href}` : null,
    context.pdfX !== undefined ? `pdf-x: ${context.pdfX}` : null,
    context.pdfY !== undefined ? `pdf-y: ${context.pdfY}` : null,
    context.text,
    '</selection-context>',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

export const appendSelectionContext = (text: string, selection?: AISelectionPayload) => {
  if (!selection) return text;
  const contexts = [
    ...(selection.questionAnchor ? [selection.questionAnchor] : []),
    ...selection.attachments.filter((item) => item.id !== selection.questionAnchor?.id),
  ];
  if (contexts.length === 0) return text;
  return `${text}\n\n${contexts.map(formatSelectionContext).join('\n\n')}`;
};

const messageText = (message: ThreadMessage) =>
  message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

const toExportedMessages = (messages: AIMessage[]): ExportedMessageRepositoryItem[] =>
  messages.map((message, index) => {
    const custom = message.selection ? { [SELECTION_CONFIG_KEY]: message.selection } : {};
    const baseMessage = {
      id: message.id,
      content: [{ type: 'text' as const, text: message.content }],
      createdAt: new Date(message.createdAt),
      metadata: { custom },
    };
    const threadMessage: ThreadMessage =
      message.role === 'user'
        ? { ...baseMessage, role: 'user', attachments: [] }
        : {
            ...baseMessage,
            role: 'assistant',
            status: { type: 'complete', reason: 'stop' },
            metadata: {
              ...baseMessage.metadata,
              unstable_state: null,
              unstable_annotations: [],
              unstable_data: [],
              steps: [],
            },
          };
    return {
      message: threadMessage,
      parentId: index > 0 ? (messages[index - 1]?.id ?? null) : null,
      ...(message.selection ? { runConfig: selectionPayloadToRunConfig(message.selection) } : {}),
    };
  });

export const createAIThreadHistoryAdapter = ({
  bookHash,
  bookTitle,
  getActiveConversationId,
  getStoredMessages,
  createConversation,
  addMessage,
  activateConversation,
  rememberMessageSelection,
}: ThreadHistoryDependencies): ThreadHistoryAdapter => {
  let conversationId = getActiveConversationId();
  let conversationPromise: Promise<string> | null = null;
  let shouldActivateCreatedConversation = false;

  const activateCreatedConversation = async (id: string) => {
    if (!shouldActivateCreatedConversation || !activateConversation) return;
    shouldActivateCreatedConversation = false;
    await activateConversation(id);
  };

  const ensureConversation = (title: string, anchor?: AISelectionContext | null) => {
    if (conversationId) return Promise.resolve(conversationId);
    conversationPromise ??= createConversation(
      bookHash,
      title.trim().slice(0, 50) || `Chat about ${bookTitle}`,
      anchor,
      false,
    ).then((id) => {
      conversationId = id;
      shouldActivateCreatedConversation = true;
      return id;
    });
    return conversationPromise;
  };

  return {
    async load() {
      return { messages: toExportedMessages(getStoredMessages()) };
    },
    async append(item) {
      if (item.message.role === 'system') return;
      const content = messageText(item.message);
      if (!content) {
        if (item.message.role === 'assistant' && conversationPromise) {
          await activateCreatedConversation(await conversationPromise);
        }
        return;
      }
      const selection =
        item.message.role === 'user' ? selectionPayloadFromRunConfig(item.runConfig) : undefined;
      if (selection) rememberMessageSelection?.(item.message.id, selection);
      const id = await ensureConversation(content, selection?.questionAnchor);
      await addMessage({
        conversationId: id,
        role: item.message.role,
        content,
        ...(selection ? { selection } : {}),
      });
      if (item.message.role === 'assistant') await activateCreatedConversation(id);
    },
  };
};
