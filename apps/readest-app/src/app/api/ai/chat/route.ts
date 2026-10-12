import { validateUserAndToken } from '@/utils/access';
import { GATEWAY_MODELS } from '@/services/ai/constants';
import { streamText, createGateway } from 'ai';
import type { ModelMessage } from 'ai';

// Bounds on a single request so one caller cannot run up an unbounded bill on
// the server's AI Gateway key: cap how much context we forward, how much the
// model may generate, and how long the upstream call may run.
const MAX_MESSAGES = 50;
const MAX_TOTAL_CHARS = 100_000;
const MAX_OUTPUT_TOKENS = 2048;
const REQUEST_TIMEOUT_MS = 60_000;

// Models the *server* key is allowed to drive — the curated set of cheap
// models the client already offers. A user who brings their own key keeps full
// model choice (including custom models); only the paid fallback is restricted.
const SERVER_KEY_ALLOWED_MODELS = new Set<string>(Object.values(GATEWAY_MODELS));

const totalMessageChars = (messages: { content?: unknown }[]): number =>
  messages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);

export async function POST(req: Request): Promise<Response> {
  try {
    const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
    if (!user || !token) {
      return Response.json({ error: 'Not authenticated' }, { status: 403 });
    }

    const { messages, system, apiKey, model } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (messages.length > MAX_MESSAGES || totalMessageChars(messages) > MAX_TOTAL_CHARS) {
      return new Response(JSON.stringify({ error: 'Request too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // A client key means the user pays for their own usage, so we honour it and
    // their model choice. Without one we fall back to the server's paid key —
    // and then only for the curated, cheap model allow-list.
    const clientKey = typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : undefined;
    const usingServerKey = !clientKey;
    const gatewayApiKey = clientKey || process.env['AI_GATEWAY_API_KEY'];
    if (!gatewayApiKey) {
      return new Response(JSON.stringify({ error: 'API key required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const modelId = model || 'google/gemini-2.5-flash-lite';
    if (usingServerKey && !SERVER_KEY_ALLOWED_MODELS.has(modelId)) {
      return new Response(JSON.stringify({ error: 'Model not allowed' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const gateway = createGateway({ apiKey: gatewayApiKey });
    const languageModel = gateway(modelId);

    const result = streamText({
      model: languageModel,
      system: system || 'You are a helpful assistant.',
      messages: messages as ModelMessage[],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
