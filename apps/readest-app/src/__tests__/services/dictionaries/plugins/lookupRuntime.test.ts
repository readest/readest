import { expect, test, vi } from 'vitest';
import { acquirePluginLookupRuntime } from '@/services/dictionaries/plugins/lookupRuntime';
import type { BundledPluginDefinition } from '@/services/plugins/catalog';
import { yomitanPluginManifest } from '@/plugins/yomitan/manifest';

test('shares one lookup runtime per host and plugin until its final consumer releases it', () => {
  const plugin: BundledPluginDefinition = {
    manifest: yomitanPluginManifest,
    createWorker: vi.fn(() => {
      throw new Error('The lazy Worker should not start during pool acquisition');
    }),
  };
  const host = {};

  const first = acquirePluginLookupRuntime(host, plugin);
  const second = acquirePluginLookupRuntime(host, plugin);
  expect(second.runtime).toBe(first.runtime);
  expect(second.sourceBroker).toBe(first.sourceBroker);
  expect(second.sqlBroker).toBe(first.sqlBroker);

  first.release();
  const whileReferenced = acquirePluginLookupRuntime(host, plugin);
  expect(whileReferenced.runtime).toBe(second.runtime);
  second.release();
  whileReferenced.release();

  const afterFinalRelease = acquirePluginLookupRuntime(host, plugin);
  expect(afterFinalRelease.runtime).not.toBe(first.runtime);
  afterFinalRelease.release();
  expect(plugin.createWorker).not.toHaveBeenCalled();
});
