import type { AppService } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import { getBundledPlugin, type BundledPluginDefinition } from '@/services/plugins/catalog';
import type { PluginResult } from '@/services/plugins/contract';
import type { DatabaseService } from '@/types/database';
import type { DictionaryProvider, ImportedDictionary } from '../types';
import type { DictionaryPluginControlStore } from './controlStore';
import { getDictionaryPluginControlStore } from './controlService';
import { acquirePluginLookupRuntime, type PluginLookupRuntimeLease } from './lookupRuntime';
import { renderPluginDictionaryResult } from './renderer';

type PluginProviderHost = Pick<AppService, 'openFile' | 'openDatabase' | 'deleteDatabase'>;

interface CreatePluginDictionaryProviderArgs {
  dict: ImportedDictionary;
  host: PluginProviderHost;
  plugin?: BundledPluginDefinition;
  controlStore?: DictionaryPluginControlStore;
}

interface ProviderState {
  source: File;
  sourceHandle: string;
  database: DatabaseService;
  databaseHandle: string;
  lookupRuntime: PluginLookupRuntimeLease;
}

const MAX_RESOURCE_CACHE_BYTES = 16 * 1_024 * 1_024;

const isBrokenDerivedDatabaseError = (error: unknown): boolean =>
  /ENOENT|NO SUCH FILE|NOT FOUND|DOES NOT EXIST|MISSING|CORRUPT|MALFORMED|NOT A DATABASE|INVALID .*INDEX|INDEX VERSION MISMATCH|INDEX IS EMPTY/iu.test(
    error instanceof Error ? error.message : String(error),
  );

export const createPluginDictionaryProvider = ({
  dict,
  host,
  plugin: providedPlugin,
  controlStore: providedControlStore,
}: CreatePluginDictionaryProviderArgs): DictionaryProvider => {
  const metadata = dict.plugin;
  if (!metadata || !dict.files.pluginSource) {
    throw new Error('Plugin dictionary metadata is incomplete');
  }
  const plugin = providedPlugin ?? getBundledPlugin(metadata.pluginId);
  if (!plugin) throw new Error(`Bundled dictionary plugin is unavailable: ${metadata.pluginId}`);
  let state: ProviderState | undefined;
  let initializing: Promise<ProviderState> | undefined;
  let disposed = false;
  const resources = new Map<string, PluginResult<'readResource'>>();
  let resourceCacheBytes = 0;

  const init = async (): Promise<ProviderState> => {
    if (disposed) throw new Error('Dictionary provider has been disposed');
    if (state) return state;
    if (initializing) return initializing;
    initializing = (async () => {
      const controlStore =
        providedControlStore ?? (await getDictionaryPluginControlStore(host as AppService));
      const generation = await controlStore.getActiveGeneration(dict.id);
      if (!generation)
        throw new Error('Dictionary plugin index is not materialized on this device');
      if (generation.pluginId !== metadata.pluginId)
        throw new Error('Dictionary plugin index owner mismatch');
      if (generation.indexVersion !== metadata.indexVersion) {
        throw new Error('Dictionary plugin index needs to be rebuilt');
      }
      const source = await host.openFile(
        `${dict.bundleDir}/${dict.files.pluginSource}`,
        'Dictionaries',
      );
      if (source.size !== metadata.source.byteSize) {
        await (source as ClosableFile).close?.();
        throw new Error('Dictionary plugin source size does not match its manifest');
      }
      const scope = { pluginId: metadata.pluginId, dictionaryId: dict.id };
      const lookupRuntime = acquirePluginLookupRuntime(host, plugin);
      const sourceHandle = lookupRuntime.sourceBroker.register(scope, source);
      let database: DatabaseService | undefined;
      let databaseHandle: string | undefined;
      let verified = false;
      try {
        database = await host.openDatabase(
          'dictionary-plugin-index',
          generation.databasePath,
          'Dictionaries',
        );
        databaseHandle = await lookupRuntime.sqlBroker.register(scope, database, 'active');
        await lookupRuntime.runtime.call('verifyIndex', {
          dictionaryId: dict.id,
          databaseHandle,
        });
        if (generation.state === 'active') {
          await controlStore.markGenerationHealthy(dict.id, generation.buildId);
        }
        verified = true;
        const ready = {
          source,
          sourceHandle,
          database,
          databaseHandle,
          lookupRuntime,
        };
        if (disposed) {
          throw new Error('Dictionary provider has been disposed');
        }
        state = ready;
        return ready;
      } catch (error) {
        if (databaseHandle) lookupRuntime.sqlBroker.revoke(databaseHandle);
        lookupRuntime.sourceBroker.revoke(sourceHandle);
        lookupRuntime.release();
        await database?.close().catch(() => undefined);
        await (source as ClosableFile).close?.();
        if (!verified && generation.state === 'active') {
          await controlStore
            .rollbackUnhealthyGeneration(dict.id, generation.buildId)
            .catch(() => undefined);
        } else if (
          !verified &&
          generation.state === 'healthy' &&
          isBrokenDerivedDatabaseError(error)
        ) {
          await controlStore
            .discardFailedGeneration(dict.id, generation.buildId, 'healthy')
            .catch(() => undefined);
        }
        throw error;
      }
    })().finally(() => {
      initializing = undefined;
    });
    return initializing;
  };

  const resolveResource = async (
    ready: ProviderState,
    resourceRef: string,
  ): Promise<PluginResult<'readResource'>> => {
    const cached = resources.get(resourceRef);
    if (cached) return cached;
    const resource = await ready.lookupRuntime.runtime.call('readResource', {
      dictionaryId: dict.id,
      sourceHandle: ready.sourceHandle,
      databaseHandle: ready.databaseHandle,
      resourceRef,
    });
    if (resourceCacheBytes + resource.bytes.byteLength <= MAX_RESOURCE_CACHE_BYTES) {
      resources.set(resourceRef, resource);
      resourceCacheBytes += resource.bytes.byteLength;
    }
    return resource;
  };

  return {
    id: dict.id,
    kind: 'plugin',
    label: dict.name,
    init: async () => {
      await init();
    },
    async lookup(word, context) {
      try {
        const ready = await init();
        const result = await ready.lookupRuntime.runtime.call(
          'lookup',
          {
            dictionaryId: dict.id,
            databaseHandle: ready.databaseHandle,
            query: word,
            ...(context.lang ? { language: context.lang } : {}),
          },
          { signal: context.signal },
        );
        if (result.entries.length === 0) return { ok: false, reason: 'empty' };
        await renderPluginDictionaryResult(context.container, result, {
          onNavigate: context.onNavigate,
          resolveResource: (resourceRef) => resolveResource(ready, resourceRef),
        });
        return {
          ok: true,
          headword: result.entries[0]?.expression,
          sourceLabel: dict.name,
        };
      } catch (error) {
        if (context.signal.aborted) return { ok: false, reason: 'error', message: 'aborted' };
        return {
          ok: false,
          reason: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    dispose() {
      disposed = true;
      resources.clear();
      resourceCacheBytes = 0;
      const ready = state;
      state = undefined;
      if (!ready) return;
      ready.lookupRuntime.sqlBroker.revoke(ready.databaseHandle);
      ready.lookupRuntime.sourceBroker.revoke(ready.sourceHandle);
      ready.lookupRuntime.release();
      void ready.database.close();
      void (ready.source as ClosableFile).close?.();
    },
  };
};
