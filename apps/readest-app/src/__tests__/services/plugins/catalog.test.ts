import { describe, expect, test } from 'vitest';
import { PLUGIN_PROTOCOL_VERSION } from '@/services/plugins/contract';
import { bundledPluginCatalog, findDictionaryFormatPlugin } from '@/services/plugins/catalog';

describe('bundled plugin catalog', () => {
  test('registers raw and pre-indexed Yomitan contributions at build time', () => {
    expect(bundledPluginCatalog).toHaveLength(1);
    expect(bundledPluginCatalog[0]!.manifest).toMatchObject({
      id: 'readest.yomitan',
      protocolVersion: PLUGIN_PROTOCOL_VERSION,
      pluginVersion: '1.0.0',
      contributions: {
        dictionaryFormats: [
          {
            id: 'yomitan',
            extensions: ['zip'],
            indexVersion: 2,
            materialization: 'sql',
          },
          {
            id: 'yomitan-indexed',
            extensions: ['rdict'],
            indexVersion: 2,
            materialization: 'database',
          },
        ],
      },
    });
    expect(findDictionaryFormatPlugin('ZIP')?.manifest.id).toBe('readest.yomitan');
    expect(findDictionaryFormatPlugin('.RDICT')?.manifest.id).toBe('readest.yomitan');
    expect(findDictionaryFormatPlugin('mdx')).toBeUndefined();
  });
});
