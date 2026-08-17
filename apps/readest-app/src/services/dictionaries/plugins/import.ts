import type { SelectedFile } from '@/hooks/useFileSelector';
import type { DatabaseService } from '@/types/database';
import type { AppService, DictionaryImportProgressHandler } from '@/types/system';
import type { ClosableFile } from '@/utils/file';
import { uniqueId } from '@/utils/misc';
import { getFilename } from '@/utils/path';
import { v4 as uuidv4 } from 'uuid';
import {
  findExistingDictionaryMatches,
  findTombstonedDictionaryMatches,
  preserveLiveDictionaryState,
  preserveUserCustomName,
  shouldMintReincarnationForLiveReimport,
} from '../dictionaryDedup';
import type { ImportedDictionary } from '../types';
import { SourceBroker, SqlBroker } from '@/services/plugins/brokers';
import {
  findDictionaryFormatPlugin,
  type BundledPluginDefinition,
} from '@/services/plugins/catalog';
import { createPluginHostCallHandler } from '@/services/plugins/hostCalls';
import { createPluginRuntime } from '@/services/plugins/runtime';
import type { DictionaryPluginControlStore, DictionaryPluginLease } from './controlStore';
import { getDictionaryPluginControlStore } from './controlService';
import {
  computePluginDictionaryContentId,
  sha256File,
  type PluginSourceManifestEntry,
} from './integrity';

interface PluginImportHost
  extends Pick<
    AppService,
    | 'openFile'
    | 'createDir'
    | 'writeFile'
    | 'deleteDir'
    | 'openDatabase'
    | 'installDatabase'
    | 'deleteDatabase'
  > {}

interface PluginImportDependencies {
  resolvePlugin?: (extension: string) => BundledPluginDefinition | undefined;
  controlStore?: DictionaryPluginControlStore;
  createBuildId?: () => string;
  isWorkerSupported?: () => boolean;
  onProgress?: DictionaryImportProgressHandler;
}

export interface ImportPluginDictionariesResult {
  imported: ImportedDictionary[];
  replacements: { oldIds: string[]; newDict: ImportedDictionary }[];
  unclaimed: SelectedFile[];
  failures: { name: string; message: string }[];
}

const randomBuildId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const selectedName = (source: SelectedFile): string =>
  source.file?.name ?? source.name ?? (source.path ? getFilename(source.path) : '');

const extensionOf = (name: string): string => {
  const index = name.lastIndexOf('.');
  return index < 0 ? '' : name.slice(index + 1).toLowerCase();
};

const assertSafeFilename = (name: string): string => {
  if (
    !name ||
    name.length > 255 ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error('Dictionary plugin source filename is unsafe');
  }
  return name;
};

const readSelectedFile = async (host: PluginImportHost, source: SelectedFile): Promise<File> => {
  if (source.file) return source.file;
  if (source.path) return host.openFile(source.path, 'None');
  throw new Error('Selected dictionary source has no file or path');
};

const closeFile = async (file: File): Promise<void> => {
  const closable = file as ClosableFile;
  await closable.close?.();
};

const createDictionaryRecord = (
  dictionaryId: string,
  bundleDir: string,
  source: PluginSourceManifestEntry,
  plugin: BundledPluginDefinition,
  inspected: {
    formatId: string;
    sourceFormatVersion: number;
    title: string;
  },
): ImportedDictionary => {
  const contribution = plugin.manifest.contributions.dictionaryFormats.find(
    (format) => format.id === inspected.formatId,
  );
  if (!contribution) throw new Error(`Plugin did not declare format ${inspected.formatId}`);
  return {
    id: dictionaryId,
    contentId: dictionaryId,
    kind: 'plugin',
    name: inspected.title,
    bundleDir,
    files: { pluginSource: source.name },
    plugin: {
      recordVersion: 1,
      pluginId: plugin.manifest.id,
      formatId: inspected.formatId,
      sourceFormatVersion: inspected.sourceFormatVersion,
      indexVersion: contribution.indexVersion,
      source: {
        filename: source.name,
        byteSize: source.byteSize,
        sha256: source.sha256,
      },
    },
    addedAt: Date.now(),
  };
};

const importOne = async (
  host: PluginImportHost,
  source: SelectedFile,
  plugin: BundledPluginDefinition,
  existingDictionaries: ImportedDictionary[],
  controlStore: DictionaryPluginControlStore,
  createBuildId: () => string,
  isWorkerSupported: () => boolean,
  onProgress?: DictionaryImportProgressHandler,
): Promise<
  | { claimed: false }
  | {
      claimed: true;
      imported?: ImportedDictionary;
      replacement?: { oldIds: string[]; newDict: ImportedDictionary };
    }
> => {
  if (!isWorkerSupported()) {
    throw new Error('Dictionary plugins require Web Worker support');
  }
  const file = await readSelectedFile(host, source);
  const filename = assertSafeFilename(selectedName(source) || file.name);
  const sourceBroker = new SourceBroker();
  const sqlBroker = new SqlBroker();
  const initialScope = { pluginId: plugin.manifest.id };
  const sourceHandle = sourceBroker.register(initialScope, file);
  const runtime = createPluginRuntime({
    createWorker: () => plugin.createWorker('build'),
    handleHostCall: createPluginHostCallHandler(plugin.manifest.id, sourceBroker, sqlBroker),
  });
  let lease: DictionaryPluginLease | undefined;
  let stopLeaseHeartbeat: (() => Promise<void>) | undefined;
  let database: DatabaseService | undefined;
  let databaseHandle: string | undefined;
  let dictionaryId: string | undefined;
  let buildId: string | undefined;
  let databasePath: string | undefined;
  let bundleDir: string | undefined;
  let activated = false;
  let verifiedTitle: string | undefined;
  try {
    const probed = await runtime.call('probe', {
      sources: [{ handle: sourceHandle, name: filename, size: file.size }],
    });
    const match = probed.matches.find((candidate) =>
      plugin.manifest.contributions.dictionaryFormats.some(
        (format) => format.id === candidate.formatId,
      ),
    );
    if (!match || match.confidence <= 0) return { claimed: false };

    const inspected = await runtime.call('inspect', { sourceHandle });
    const sourceHash = await sha256File(file);
    const sourceManifest: PluginSourceManifestEntry = {
      name: filename,
      byteSize: file.size,
      sha256: sourceHash,
    };
    dictionaryId = computePluginDictionaryContentId(plugin.manifest.id, inspected.formatId, [
      sourceManifest,
    ]);
    sourceBroker.rebind(sourceHandle, { pluginId: plugin.manifest.id, dictionaryId });
    const contribution = plugin.manifest.contributions.dictionaryFormats.find(
      (format) => format.id === inspected.formatId,
    );
    if (!contribution) throw new Error(`Unknown plugin dictionary format: ${inspected.formatId}`);

    lease = await controlStore.acquireLease(dictionaryId, 'build');
    stopLeaseHeartbeat = controlStore.startLeaseHeartbeat(lease);
    buildId = createBuildId();
    databasePath = `dictionary-plugin-${dictionaryId}-${buildId}.sqlite3`;
    await controlStore.stageGeneration(
      lease,
      plugin.manifest.id,
      buildId,
      databasePath,
      contribution.indexVersion,
    );
    if (contribution.materialization === 'database') {
      await host.installDatabase(databasePath, 'Dictionaries', file);
    }
    database = await host.openDatabase('dictionary-plugin-index', databasePath, 'Dictionaries');
    databaseHandle = await sqlBroker.register(
      { pluginId: plugin.manifest.id, dictionaryId },
      database,
      contribution.materialization === 'database' ? 'active' : 'staging',
    );
    if (contribution.materialization === 'sql') {
      await runtime.call(
        'buildIndex',
        {
          dictionaryId,
          sourceHandle,
          databaseHandle,
          sourceFormatVersion: inspected.sourceFormatVersion,
        },
        onProgress ? { onProgress } : {},
      );
    }
    const verified = await runtime.call('verifyIndex', { dictionaryId, databaseHandle });
    verifiedTitle = verified.title;
    await stopLeaseHeartbeat();
    stopLeaseHeartbeat = undefined;
    sqlBroker.revoke(databaseHandle);
    databaseHandle = undefined;
    await database.close();
    database = undefined;

    bundleDir = uniqueId();
    await host.createDir(bundleDir, 'Dictionaries', true);
    await host.writeFile(`${bundleDir}/${filename}`, 'Dictionaries', file);
    await controlStore.activateGeneration(lease, buildId);
    activated = true;

    database = await host.openDatabase('dictionary-plugin-index', databasePath, 'Dictionaries');
    databaseHandle = await sqlBroker.register(
      { pluginId: plugin.manifest.id, dictionaryId },
      database,
      'active',
    );
    await runtime.call('verifyIndex', { dictionaryId, databaseHandle });
    await controlStore.markGenerationHealthy(dictionaryId, buildId);

    const fresh = createDictionaryRecord(dictionaryId, bundleDir, sourceManifest, plugin, {
      ...inspected,
      ...(verifiedTitle === undefined ? {} : { title: verifiedTitle }),
    });
    const live = findExistingDictionaryMatches(fresh, existingDictionaries);
    if (live.length > 0) {
      const preserved = preserveLiveDictionaryState(fresh, live);
      const newDict = shouldMintReincarnationForLiveReimport(fresh, live)
        ? { ...preserved, reincarnation: uuidv4() }
        : preserved;
      for (const old of live) {
        if (old.bundleDir === bundleDir) continue;
        await host.deleteDir(old.bundleDir, 'Dictionaries', true).catch(() => undefined);
      }
      return {
        claimed: true,
        replacement: { oldIds: live.map((dictionary) => dictionary.id), newDict },
      };
    }
    const tombstoned = findTombstonedDictionaryMatches(fresh, existingDictionaries);
    if (tombstoned.length > 0) {
      return {
        claimed: true,
        replacement: {
          oldIds: tombstoned.map((dictionary) => dictionary.id),
          newDict: preserveUserCustomName({ ...fresh, reincarnation: uuidv4() }, tombstoned),
        },
      };
    }
    return { claimed: true, imported: fresh };
  } catch (error) {
    if (dictionaryId && buildId) {
      if (activated) await controlStore.discardFailedGeneration(dictionaryId, buildId, 'active');
      else await controlStore.markGenerationFailed(dictionaryId, buildId);
    }
    if (databasePath && !activated) {
      await host.deleteDatabase(databasePath, 'Dictionaries').catch(() => undefined);
    }
    if (bundleDir) await host.deleteDir(bundleDir, 'Dictionaries', true).catch(() => undefined);
    throw error;
  } finally {
    await stopLeaseHeartbeat?.().catch(() => undefined);
    if (databaseHandle) sqlBroker.revoke(databaseHandle);
    await database?.close().catch(() => undefined);
    if (lease) await controlStore.releaseLease(lease).catch(() => undefined);
    sourceBroker.revoke(sourceHandle);
    runtime.close();
    await closeFile(file);
  }
};

export const importPluginDictionaries = async (
  host: PluginImportHost,
  files: SelectedFile[],
  existingDictionaries: ImportedDictionary[] = [],
  dependencies: PluginImportDependencies = {},
): Promise<ImportPluginDictionariesResult> => {
  const resolvePlugin = dependencies.resolvePlugin ?? findDictionaryFormatPlugin;
  let controlStore = dependencies.controlStore;
  const createBuildId = dependencies.createBuildId ?? randomBuildId;
  const isWorkerSupported = dependencies.isWorkerSupported ?? (() => typeof Worker !== 'undefined');
  const imported: ImportedDictionary[] = [];
  const replacements: { oldIds: string[]; newDict: ImportedDictionary }[] = [];
  const unclaimed: SelectedFile[] = [];
  const failures: { name: string; message: string }[] = [];

  for (const source of files) {
    const plugin = resolvePlugin(extensionOf(selectedName(source)));
    if (!plugin) {
      unclaimed.push(source);
      continue;
    }
    let result: Awaited<ReturnType<typeof importOne>>;
    try {
      controlStore ??= await getDictionaryPluginControlStore(host as AppService);
      result = await importOne(
        host,
        source,
        plugin,
        existingDictionaries,
        controlStore,
        createBuildId,
        isWorkerSupported,
        dependencies.onProgress,
      );
    } catch (error) {
      failures.push({
        name: selectedName(source) || 'dictionary',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!result.claimed) {
      unclaimed.push(source);
    } else if (result.imported) {
      imported.push(result.imported);
      existingDictionaries = [...existingDictionaries, result.imported];
    } else if (result.replacement) {
      replacements.push(result.replacement);
      const replaced = new Set(result.replacement.oldIds);
      existingDictionaries = [
        ...existingDictionaries.filter((dictionary) => !replaced.has(dictionary.id)),
        result.replacement.newDict,
      ];
    }
  }
  return { imported, replacements, unclaimed, failures };
};
