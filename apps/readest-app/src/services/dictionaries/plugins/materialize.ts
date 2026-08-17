import type { AppService } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import type { DatabaseService } from '@/types/database';
import { SourceBroker, SqlBroker } from '@/services/plugins/brokers';
import { getBundledPlugin, type BundledPluginDefinition } from '@/services/plugins/catalog';
import { createPluginHostCallHandler } from '@/services/plugins/hostCalls';
import { createPluginRuntime } from '@/services/plugins/runtime';
import type { ImportedDictionary } from '../types';
import type {
  DictionaryPluginControlStore,
  DictionaryPluginGeneration,
  DictionaryPluginLease,
} from './controlStore';
import { getDictionaryPluginControlStore } from './controlService';
import { computePluginDictionaryContentId, sha256File } from './integrity';
import { pluginDictionaryMetadataSchema } from './record';

type MaterializationHost = Pick<
  AppService,
  'openFile' | 'openDatabase' | 'installDatabase' | 'deleteDatabase'
>;

interface MaterializeOptions {
  plugin?: BundledPluginDefinition;
  controlStore?: DictionaryPluginControlStore;
  createBuildId?: () => string;
  isWorkerSupported?: () => boolean;
  force?: boolean;
}

const createBuildId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
};

export const materializePluginDictionary = async (
  host: MaterializationHost,
  dict: ImportedDictionary,
  options: MaterializeOptions = {},
): Promise<DictionaryPluginGeneration> => {
  if (dict.kind !== 'plugin') throw new Error('Dictionary is not plugin-backed');
  const metadata = pluginDictionaryMetadataSchema.parse(dict.plugin);
  const sourceName = dict.files.pluginSource;
  if (!sourceName || sourceName !== metadata.source.filename) {
    throw new Error('Dictionary plugin source manifest is inconsistent');
  }
  const plugin = options.plugin ?? getBundledPlugin(metadata.pluginId);
  if (!plugin) throw new Error(`Bundled dictionary plugin is unavailable: ${metadata.pluginId}`);
  if (!(options.isWorkerSupported ?? (() => typeof Worker !== 'undefined'))()) {
    throw new Error('Dictionary plugins require Web Worker support');
  }
  const contribution = plugin.manifest.contributions.dictionaryFormats.find(
    (format) => format.id === metadata.formatId,
  );
  if (!contribution || contribution.indexVersion !== metadata.indexVersion) {
    throw new Error('Dictionary plugin contribution or index version is incompatible');
  }
  const controlStore =
    options.controlStore ?? (await getDictionaryPluginControlStore(host as AppService));
  const source = await host.openFile(`${dict.bundleDir}/${sourceName}`, 'Dictionaries');
  let lease: DictionaryPluginLease | undefined;
  let stopLeaseHeartbeat: (() => Promise<void>) | undefined;
  let database: DatabaseService | undefined;
  let databaseHandle: string | undefined;
  let buildId: string | undefined;
  let databasePath: string | undefined;
  let activated = false;
  const sourceBroker = new SourceBroker();
  const sqlBroker = new SqlBroker();
  const scope = { pluginId: metadata.pluginId, dictionaryId: dict.id };
  const sourceHandle = sourceBroker.register(scope, source);
  const runtime = createPluginRuntime({
    createWorker: () => plugin.createWorker('build'),
    handleHostCall: createPluginHostCallHandler(metadata.pluginId, sourceBroker, sqlBroker),
  });
  try {
    if (source.size !== metadata.source.byteSize) {
      throw new Error('Dictionary plugin source integrity check failed: size mismatch');
    }
    const sourceSha256 = await sha256File(source);
    if (sourceSha256 !== metadata.source.sha256) {
      throw new Error('Dictionary plugin source integrity check failed: SHA-256 mismatch');
    }
    const contentId = computePluginDictionaryContentId(metadata.pluginId, metadata.formatId, [
      { name: sourceName, byteSize: source.size, sha256: sourceSha256 },
    ]);
    if (contentId !== (dict.contentId ?? dict.id)) {
      throw new Error('Dictionary plugin source integrity check failed: content identity mismatch');
    }

    const current = await controlStore.getActiveGeneration(dict.id);
    if (
      !options.force &&
      current &&
      current.pluginId === metadata.pluginId &&
      current.indexVersion === metadata.indexVersion
    ) {
      return current;
    }

    lease = await controlStore.acquireLease(dict.id, 'build');
    stopLeaseHeartbeat = controlStore.startLeaseHeartbeat(lease);
    buildId = (options.createBuildId ?? createBuildId)();
    databasePath = `dictionary-plugin-${dict.id}-${buildId}.sqlite3`;
    await controlStore.stageGeneration(
      lease,
      metadata.pluginId,
      buildId,
      databasePath,
      metadata.indexVersion,
    );
    if (contribution.materialization === 'database') {
      await host.installDatabase(databasePath, 'Dictionaries', source);
    }
    database = await host.openDatabase('dictionary-plugin-index', databasePath, 'Dictionaries');
    databaseHandle = await sqlBroker.register(
      scope,
      database,
      contribution.materialization === 'database' ? 'active' : 'staging',
    );
    if (contribution.materialization === 'sql') {
      await runtime.call('buildIndex', {
        dictionaryId: dict.id,
        sourceHandle,
        databaseHandle,
        sourceFormatVersion: metadata.sourceFormatVersion,
      });
    }
    await runtime.call('verifyIndex', { dictionaryId: dict.id, databaseHandle });
    await stopLeaseHeartbeat();
    stopLeaseHeartbeat = undefined;
    sqlBroker.revoke(databaseHandle);
    databaseHandle = undefined;
    await database.close();
    database = undefined;

    await controlStore.activateGeneration(lease, buildId);
    activated = true;
    database = await host.openDatabase('dictionary-plugin-index', databasePath, 'Dictionaries');
    databaseHandle = await sqlBroker.register(scope, database, 'active');
    await runtime.call('verifyIndex', { dictionaryId: dict.id, databaseHandle });
    await controlStore.markGenerationHealthy(dict.id, buildId);
    const generation = await controlStore.getActiveGeneration(dict.id);
    if (!generation) throw new Error('Dictionary plugin activation did not persist');
    return generation;
  } catch (error) {
    if (buildId) {
      if (activated) await controlStore.discardFailedGeneration(dict.id, buildId, 'active');
      else await controlStore.markGenerationFailed(dict.id, buildId);
    }
    if (databasePath && !activated) {
      await host.deleteDatabase(databasePath, 'Dictionaries').catch(() => undefined);
    }
    throw error;
  } finally {
    await stopLeaseHeartbeat?.().catch(() => undefined);
    if (databaseHandle) sqlBroker.revoke(databaseHandle);
    await database?.close().catch(() => undefined);
    if (lease) await controlStore.releaseLease(lease).catch(() => undefined);
    sourceBroker.revoke(sourceHandle);
    runtime.close();
    await (source as ClosableFile).close?.();
  }
};
