import { AppService } from '@/types/system';

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AIConversation {
  id: string;
  bookKey: string;
  bookTitle: string;
  bookAuthor: string;
  snippet: string;
  snippetType: 'highlight' | 'page' | 'chapter';
  messages: AIChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AIConversationsData {
  conversations: AIConversation[];
}

const CONVERSATIONS_FILENAME = 'ai-conversations.json';

export class AIChatService {
  constructor(private appService: AppService) {}

  async loadConversations(): Promise<AIConversation[]> {
    try {
      // Try to read the file - if it doesn't exist, openFile will throw
      const file = await this.appService.openFile(CONVERSATIONS_FILENAME, 'Settings');
      const text = await file.text();
      if (!text || text.trim().length === 0) {
        return [];
      }
      const parsed = JSON.parse(text) as AIConversationsData;
      return parsed.conversations || [];
    } catch (error) {
      // File doesn't exist or other error - return empty array silently
      // Only log unexpected errors
      if (
        error instanceof Error &&
        !error.message.includes('not found') &&
        !error.message.includes('No such file') &&
        !error.message.includes('does not exist')
      ) {
        console.error('Failed to load AI conversations:', error);
      }
      return [];
    }
  }

  async saveConversations(conversations: AIConversation[]): Promise<void> {
    try {
      const data: AIConversationsData = { conversations };
      const jsonData = JSON.stringify(data, null, 2);
      await this.appService.writeFile(CONVERSATIONS_FILENAME, 'Settings', jsonData);
    } catch (error) {
      console.error('Failed to save AI conversations:', error);
      throw error;
    }
  }

  async addConversation(conversation: AIConversation): Promise<void> {
    const conversations = await this.loadConversations();
    conversations.unshift(conversation);
    await this.saveConversations(conversations);
  }

  async updateConversation(
    conversationId: string,
    updates: Partial<AIConversation>,
  ): Promise<void> {
    const conversations = await this.loadConversations();
    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index !== -1) {
      conversations[index] = { ...conversations[index]!, ...updates, updatedAt: Date.now() };
      await this.saveConversations(conversations);
    }
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const conversations = await this.loadConversations();
    const filtered = conversations.filter((c) => c.id !== conversationId);
    await this.saveConversations(filtered);
  }

  async getConversation(conversationId: string): Promise<AIConversation | null> {
    const conversations = await this.loadConversations();
    return conversations.find((c) => c.id === conversationId) || null;
  }
}
