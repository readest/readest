import { pluginManifestSchema } from '@/services/plugins/contract';

export const ocrPluginManifest = pluginManifestSchema.parse({
  id: 'readest.ocr',
  protocolVersion: 1,
  pluginVersion: '1.0.0',
  contributions: { ocr: true },
});
