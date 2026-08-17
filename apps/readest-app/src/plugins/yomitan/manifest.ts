import { pluginManifestSchema } from '@/services/plugins/contract';

export const yomitanPluginManifest = pluginManifestSchema.parse({
  id: 'readest.yomitan',
  protocolVersion: 1,
  pluginVersion: '1.0.0',
  builtAt: '2026-08-16T00:00:00.000Z',
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
