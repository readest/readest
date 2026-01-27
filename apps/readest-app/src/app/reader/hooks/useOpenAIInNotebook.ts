import { useCallback } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useAIChatStore } from '@/store/aiChatStore';

// Hook to open the Notebook panel with the AI tab and optionally load a specific conversation

export function useOpenAIInNotebook() {
  const { setNotebookVisible, setNotebookActiveTab } = useNotebookStore();
  const { setActiveConversation, createConversation } = useAIChatStore();

  const openAIInNotebook = useCallback(
    async (options?: {
      conversationId?: string;
      bookHash?: string;
      newConversationTitle?: string;
    }) => {
      // Open notebook and switch to AI tab
      setNotebookVisible(true);
      setNotebookActiveTab('ai');

      if (options?.conversationId) {
        // Load existing conversation
        await setActiveConversation(options.conversationId);
      } else if (options?.bookHash && options?.newConversationTitle) {
        // Create new conversation
        await createConversation(options.bookHash, options.newConversationTitle);
      }
    },
    [setNotebookVisible, setNotebookActiveTab, setActiveConversation, createConversation],
  );

  const closeAIInNotebook = useCallback(() => {
    setNotebookActiveTab('notes');
  }, [setNotebookActiveTab]);

  return {
    openAIInNotebook,
    closeAIInNotebook,
  };
}

export default useOpenAIInNotebook;
