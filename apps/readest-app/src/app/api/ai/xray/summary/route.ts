import { validateUserAndToken } from '@/utils/access';
import { xraySummarySchema } from '@/services/ai/xray/validators';

const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const XRAY_MODEL = 'openai/gpt-5-nano';

const summaryJsonSchema = {
  name: 'xray_summary_v1',
  description: 'X-Ray entity summary schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary'],
    properties: {
      summary: { type: 'string' },
    },
  },
};

export async function POST(req: Request): Promise<Response> {
  try {
    if (process.env.NODE_ENV !== 'development') {
      const { user, token } = await validateUserAndToken(req.headers.get('authorization'));
      if (!user || !token) {
        return Response.json({ error: 'Not authenticated' }, { status: 403 });
      }
    }

    const { prompt, system, apiKey, model } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return Response.json({ error: 'Prompt required' }, { status: 400 });
    }

    const gatewayApiKey = apiKey || process.env['AI_GATEWAY_API_KEY'];
    if (!gatewayApiKey) {
      return Response.json({ error: 'API key required' }, { status: 401 });
    }

    const requestedModel =
      typeof model === 'string' && model.trim().length > 0 ? model : XRAY_MODEL;

    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayApiKey}`,
      },
      body: JSON.stringify({
        model: requestedModel,
        stream: false,
        messages: [
          { role: 'system', content: system || 'You are a careful literary analyst.' },
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: summaryJsonSchema,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      return new Response(
        JSON.stringify({ error: error.error || `Summary failed: ${response.status}` }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(JSON.stringify({ error: 'Empty response from AI gateway' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }

    const summary = xraySummarySchema.safeParse(parsed);
    if (summary.success) {
      return Response.json(summary.data);
    }
    return Response.json({ summary: '' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `X-Ray summary failed: ${errorMessage}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
