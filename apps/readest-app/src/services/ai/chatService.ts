import { getAIProvider } from './providers';
import { hybridSearch, isBookIndexed } from './ragService';
import { aiLogger } from './logger';
import type { AISettings, ChatMessage, ChatSession, ScoredChunk } from './types';

export function createChatSession(bookKey: string, bookHash: string): ChatSession {
  aiLogger.chat.send(0, false);
  return { bookKey, bookHash, messages: [] };
}

function buildSystemPrompt(
  bookTitle: string,
  authorName: string,
  chunks: ScoredChunk[],
  spoilerProtection: boolean,
): string {
  const contextSection =
    chunks.length > 0
      ? `\n\nRelevant passages:\n${chunks.map((c, i) => `[${i + 1}] "${c.text}"`).join('\n\n')}`
      : '';
  const spoilerNote = spoilerProtection ? '\nOnly use info from passages provided.' : '';
  return `You are a reading companion for "${bookTitle}"${authorName ? ` by ${authorName}` : ''}. Answer based on context. Be concise and helpful.${spoilerNote}${contextSection}`;
}

export async function sendMessage(
  session: ChatSession,
  userMessage: string,
  settings: AISettings,
  bookTitle: string,
  authorName: string,
  currentSectionIndex: number,
  onToken: (token: string) => void,
  onComplete: (sources: ScoredChunk[]) => void,
  onError: (error: Error) => void,
): Promise<void> {
  if (session.abortController) session.abortController.abort();
  aiLogger.chat.send(userMessage.length, false);

  const provider = getAIProvider(settings);
  let chunks: ScoredChunk[] = [];

  if (await isBookIndexed(session.bookHash)) {
    try {
      chunks = await hybridSearch(
        session.bookHash,
        userMessage,
        settings,
        settings.maxContextChunks || 5,
        settings.spoilerProtection ? currentSectionIndex : undefined,
      );
      aiLogger.chat.context(chunks.length, chunks.map((c) => c.text).join('').length);
    } catch (e) {
      aiLogger.chat.error(`RAG failed: ${(e as Error).message}`);
    }
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(bookTitle, authorName, chunks, settings.spoilerProtection),
    },
    ...session.messages,
    { role: 'user', content: userMessage },
  ];

  session.messages.push({ role: 'user', content: userMessage });
  let assistantMessage = '';

  try {
    session.abortController = await provider.chatStream(
      messages,
      (token) => {
        assistantMessage += token;
        onToken(token);
      },
      () => {
        session.messages.push({ role: 'assistant', content: assistantMessage });
        aiLogger.chat.complete(assistantMessage.length);
        onComplete(chunks);
      },
      onError,
    );
  } catch (error) {
    aiLogger.chat.error((error as Error).message);
    onError(error as Error);
  }
}

export function abortGeneration(session: ChatSession): void {
  if (session.abortController) {
    session.abortController.abort();
    session.abortController = undefined;
  }
}

export function clearSession(session: ChatSession): void {
  abortGeneration(session);
  session.messages = [];
}
