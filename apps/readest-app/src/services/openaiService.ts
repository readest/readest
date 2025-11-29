import { AIChatMessage } from './aiChatService';

export interface OpenAIResponse {
  content: string;
  error?: string;
}

export function createSystemPrompt(
  bookTitle: string,
  bookAuthor: string,
  snippet: string,
  userCustomPrompt?: string,
): string {
  const basePrompt = `User wants to talk specifically about a book snippet coming from "${bookTitle}" by ${bookAuthor}: "${snippet}". User refers specifically to this snippet.`;
  if (userCustomPrompt) {
    return `${basePrompt}\n\n${userCustomPrompt}`;
  }
  return basePrompt;
}

export async function sendChatMessage(
  apiKey: string,
  messages: AIChatMessage[],
  systemPrompt: string,
  modelSlug: string = 'gpt-4o-mini',
): Promise<OpenAIResponse> {
  if (!apiKey) {
    return {
      content: '',
      error: 'OpenAI API key is not configured. Please add your API key in Settings > AI.',
    };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelSlug,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        return {
          content: '',
          error: 'Invalid API key. Please check your OpenAI API key in Settings > AI.',
        };
      }
      if (response.status === 429) {
        return { content: '', error: 'Rate limit exceeded. Please try again later.' };
      }
      return {
        content: '',
        error: errorData.error?.message || `API error: ${response.statusText}`,
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      return { content: '', error: 'No response from OpenAI API.' };
    }

    return { content };
  } catch (error) {
    console.error('OpenAI API error:', error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return { content: '', error: 'Network error. Please check your internet connection.' };
    }
    return {
      content: '',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
