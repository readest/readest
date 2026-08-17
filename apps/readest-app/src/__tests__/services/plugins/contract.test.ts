import { describe, expect, test } from 'vitest';
import {
  MAX_PLUGIN_RESOURCE_BYTES,
  MAX_PLUGIN_SQL_REQUEST_BYTES,
  parseDictionaryLookupResult,
  parsePluginOperationResult,
  pluginHostCallSchema,
  pluginManifestSchema,
  pluginRequestSchema,
} from '@/services/plugins/contract';

const manifest = {
  id: 'readest.yomitan',
  protocolVersion: 1,
  pluginVersion: '1.0.0',
  builtAt: '2026-08-16T00:00:00.000Z',
  contributions: {
    dictionaryFormats: [
      {
        id: 'yomitan',
        extensions: ['zip'],
        indexVersion: 1,
        materialization: 'sql',
      },
    ],
  },
};

describe('pluginManifestSchema', () => {
  test('accepts the bundled Yomitan contribution', () => {
    expect(pluginManifestSchema.parse(manifest)).toEqual(manifest);
  });

  test('uses an integer protocol major rather than a calendar date', () => {
    expect(() =>
      pluginManifestSchema.parse({ ...manifest, protocolVersion: '2026-08-16' }),
    ).toThrow();
  });

  test('rejects paths disguised as extensions', () => {
    const dictionaryFormats = [
      {
        ...manifest.contributions.dictionaryFormats[0],
        extensions: ['../zip'],
      },
    ];
    expect(() =>
      pluginManifestSchema.parse({
        ...manifest,
        contributions: { dictionaryFormats },
      }),
    ).toThrow();
  });
});

describe('pluginRequestSchema', () => {
  test('validates an operation-specific lookup request', () => {
    const request = {
      kind: 'request',
      protocolVersion: 1,
      requestId: 'request-1',
      operation: 'lookup',
      payload: {
        dictionaryId: 'dict-1',
        databaseHandle: 'db-1',
        query: '読みました',
        language: 'ja',
      },
    };
    expect(pluginRequestSchema.parse(request)).toEqual(request);
  });

  test('rejects a lookup without an opaque database handle', () => {
    expect(() =>
      pluginRequestSchema.parse({
        kind: 'request',
        protocolVersion: 1,
        requestId: 'request-1',
        operation: 'lookup',
        payload: { dictionaryId: 'dict-1', query: '読む' },
      }),
    ).toThrow();
  });
});

describe('plugin operation protocol', () => {
  test('accepts metadata returned while verifying an installed database', () => {
    expect(
      parsePluginOperationResult('verifyIndex', {
        indexVersion: 2,
        entries: 435_448,
        title: 'Jitendex',
      }),
    ).toEqual({ indexVersion: 2, entries: 435_448, title: 'Jitendex' });
  });

  test('keeps plugin resources opaque to the protocol', () => {
    const resource = {
      mimeType: 'image/bmp',
      bytes: new Uint8Array([66, 77]),
    };

    expect(parsePluginOperationResult('readResource', resource)).toEqual(resource);
  });

  test('accepts bounded bulk SQL parameters', () => {
    const hostCall = {
      kind: 'host-call',
      protocolVersion: 1,
      requestId: 'request-1',
      callId: 'call-1',
      capability: 'sql.transaction',
      payload: {
        handle: 'db-1',
        statements: [{ sql: 'INSERT INTO terms(value) VALUES (?)', params: Array(9_000).fill(1) }],
      },
    };

    expect(pluginHostCallSchema.parse(hostCall)).toEqual(hostCall);
    expect(() =>
      pluginHostCallSchema.parse({
        ...hostCall,
        payload: {
          ...hostCall.payload,
          statements: [{ ...hostCall.payload.statements[0], params: Array(9_001).fill(1) }],
        },
      }),
    ).toThrow();
  });

  test('rejects oversized SQL parameter cells and transaction payloads', () => {
    const hostCall = {
      kind: 'host-call',
      protocolVersion: 1,
      requestId: 'request-1',
      callId: 'call-1',
      capability: 'sql.execute',
      payload: {
        handle: 'db-1',
        sql: 'INSERT INTO resources(data) VALUES (?)',
        params: [new Uint8Array(MAX_PLUGIN_RESOURCE_BYTES + 1)],
      },
    };

    expect(() => pluginHostCallSchema.parse(hostCall)).toThrow(/parameter.*size/i);
    expect(() =>
      pluginHostCallSchema.parse({
        ...hostCall,
        capability: 'sql.transaction',
        payload: {
          handle: 'db-1',
          statements: [
            {
              sql: hostCall.payload.sql,
              params: [new Uint8Array(MAX_PLUGIN_RESOURCE_BYTES)],
            },
            {
              sql: hostCall.payload.sql,
              params: [new Uint8Array(MAX_PLUGIN_SQL_REQUEST_BYTES - MAX_PLUGIN_RESOURCE_BYTES)],
            },
            { sql: hostCall.payload.sql, params: [new Uint8Array(1)] },
          ],
        },
      }),
    ).toThrow(/transaction.*size/i);
  });
});

describe('parseDictionaryLookupResult', () => {
  test('accepts semantic entries and safe structured content', () => {
    const result = {
      entries: [
        {
          expression: '読む',
          reading: 'よむ',
          rules: ['v5'],
          score: 100,
          deinflection: ['polite past'],
          tags: [{ name: 'v5', category: 'partOfSpeech', notes: 'Godan verb' }],
          frequencies: [{ value: 42, displayValue: '42' }],
          pitches: [{ position: 1, tags: [] }],
          ipa: [{ value: '[jo̞mɯ̟ᵝ]' }],
          definitions: [
            {
              type: 'element',
              tag: 'p',
              children: [
                { type: 'text', value: 'to ' },
                {
                  type: 'element',
                  tag: 'ruby',
                  children: [
                    { type: 'text', value: '読' },
                    {
                      type: 'element',
                      tag: 'rt',
                      children: [{ type: 'text', value: 'よ' }],
                    },
                  ],
                },
                { type: 'text', value: 'む' },
              ],
            },
            {
              type: 'image',
              resourceRef: 'image:entry-1',
              alt: 'stroke order',
              width: 160,
              height: 160,
              sizeUnits: 'px',
            },
            {
              type: 'link',
              label: 'Related term',
              target: { type: 'lookup', word: '読書' },
            },
          ],
        },
      ],
    };

    expect(parseDictionaryLookupResult(result)).toEqual(result);
  });

  test('rejects raw HTML nodes and unsafe URL schemes', () => {
    expect(() =>
      parseDictionaryLookupResult({
        entries: [
          {
            expression: 'x',
            reading: 'x',
            definitions: [{ type: 'html', value: '<img src=x onerror=alert(1)>' }],
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      parseDictionaryLookupResult({
        entries: [
          {
            expression: 'x',
            reading: 'x',
            definitions: [
              {
                type: 'link',
                label: 'unsafe',
                target: { type: 'external', url: 'javascript:alert(1)' },
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  test('caps recursive document depth and total nodes', () => {
    let node: unknown = { type: 'text', value: 'deep' };
    for (let i = 0; i < 20; i += 1) {
      node = { type: 'element', tag: 'div', children: [node] };
    }
    expect(() =>
      parseDictionaryLookupResult({
        entries: [{ expression: 'x', reading: 'x', definitions: [node] }],
      }),
    ).toThrow(/depth/i);

    expect(() =>
      parseDictionaryLookupResult({
        entries: [
          {
            expression: 'x',
            reading: 'x',
            definitions: Array.from({ length: 1_100 }, (_, index) => ({
              type: 'text',
              value: String(index),
            })),
          },
        ],
      }),
    ).toThrow(/nodes/i);
  });
});
