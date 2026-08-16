import { yomitanPluginManifest } from '@/plugins/yomitan/manifest';
import type { PluginManifest } from './contract';
import type { PluginWorkerLike } from './runtime';

export type PluginWorkerRole = 'lookup' | 'build';

export interface BundledPluginDefinition {
  manifest: PluginManifest;
  createWorker(role: PluginWorkerRole): PluginWorkerLike;
}

const yomitanPlugin: BundledPluginDefinition = {
  manifest: yomitanPluginManifest,
  createWorker: () =>
    new Worker(new URL('../../plugins/yomitan/worker.ts', import.meta.url), { type: 'module' }),
};

export const bundledPluginCatalog: readonly BundledPluginDefinition[] = [yomitanPlugin];

export const findDictionaryFormatPlugin = (
  extension: string,
): BundledPluginDefinition | undefined => {
  const normalized = extension.replace(/^\./u, '').toLowerCase();
  return bundledPluginCatalog.find((plugin) =>
    plugin.manifest.contributions.dictionaryFormats.some((format) =>
      format.extensions.includes(normalized),
    ),
  );
};

export const getBundledPlugin = (pluginId: string): BundledPluginDefinition | undefined =>
  bundledPluginCatalog.find((plugin) => plugin.manifest.id === pluginId);
