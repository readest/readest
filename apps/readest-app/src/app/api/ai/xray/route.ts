import { validateUserAndToken } from '@/utils/access';
import { parseXRayExtraction } from '@/services/ai/xray/validators';

const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const XRAY_MODEL = 'openai/gpt-5-nano';

const xrayJsonSchema = {
  name: 'xray_extraction_v1',
  description: 'X-Ray extraction output schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['entities', 'relationships', 'events', 'claims'],
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'type'],
          properties: {
            name: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'character',
                'location',
                'organization',
                'artifact',
                'term',
                'event',
                'concept',
              ],
            },
            aliases: { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            first_seen_page: { type: 'integer' },
            last_seen_page: { type: 'integer' },
            facts: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['key', 'value'],
                properties: {
                  key: { type: 'string' },
                  value: { type: 'string' },
                  inferred: { type: 'boolean' },
                  evidence: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        quote: { type: 'string' },
                        page: { type: 'integer' },
                        chunkId: { type: 'string' },
                        confidence: { type: 'number' },
                        inferred: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      relationships: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'target', 'type'],
          properties: {
            source: { type: 'string' },
            target: { type: 'string' },
            type: { type: 'string' },
            description: { type: 'string' },
            inferred: { type: 'boolean' },
            first_seen_page: { type: 'integer' },
            last_seen_page: { type: 'integer' },
            strength: { type: 'number' },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  quote: { type: 'string' },
                  page: { type: 'integer' },
                  chunkId: { type: 'string' },
                  confidence: { type: 'number' },
                  inferred: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      events: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['summary'],
          properties: {
            page: { type: 'integer' },
            summary: { type: 'string' },
            importance: { type: 'integer' },
            involved_entities: { type: 'array', items: { type: 'string' } },
            arc: { type: 'string' },
            tone: { type: 'string' },
            emotions: { type: 'array', items: { type: 'string' } },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  quote: { type: 'string' },
                  page: { type: 'integer' },
                  chunkId: { type: 'string' },
                  confidence: { type: 'number' },
                  inferred: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      claims: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'description'],
          properties: {
            type: { type: 'string' },
            subject: { type: 'string' },
            object: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string', enum: ['TRUE', 'FALSE', 'SUSPECTED'] },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  quote: { type: 'string' },
                  page: { type: 'integer' },
                  chunkId: { type: 'string' },
                  confidence: { type: 'number' },
                  inferred: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
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
          json_schema: xrayJsonSchema,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      return new Response(
        JSON.stringify({ error: error.error || `Extraction failed: ${response.status}` }),
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

    const parsed = parseXRayExtraction(content);
    if (parsed) {
      return Response.json(parsed);
    }
    return Response.json({ entities: [], relationships: [], events: [], claims: [] });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: `X-Ray extraction failed: ${errorMessage}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
