import { streamText, createGateway } from 'ai';
import type { CoreMessage } from 'ai';

export const runtime = 'edge';

export async function POST(req: Request): Promise<Response> {
  try {
    const { messages, system, apiKey, model } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const gatewayApiKey = apiKey || process.env['AI_GATEWAY_API_KEY'];
    if (!gatewayApiKey) {
      return new Response(JSON.stringify({ error: 'API key required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const gateway = createGateway({ apiKey: gatewayApiKey });
    const languageModel = gateway(model || 'google/gemini-2.5-flash-lite');

    const result = streamText({
      model: languageModel,
      system: system || 'You are a helpful assistant.',
      messages: messages as CoreMessage[],
    });

    return result.toTextStreamResponse();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `Chat failed: ${errorMessage}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
