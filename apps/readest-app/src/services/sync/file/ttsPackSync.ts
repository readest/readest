// Cross-device sync of TTS section packs (phase B of the pack sync design in
// .agents/plans/2026-07-13-tts-cache-sqlite-packs.md section 9). Packs are
// immutable and named by the hash of their ordered entry keys, so the whole
// protocol is an existence check: a remote file with the right name already
// has the right bytes. Deletions never propagate — local eviction is a local
// budget decision and the remote acts as a shared pack library on the user's
// own storage.
//
// Sidecars are uploaded AFTER their mp3 so a sidecar's presence always
// implies a complete pack; the pull side only trusts mp3+json pairs and the
// importer re-validates the sidecar against the bytes anyway.
//
// Everything here is fire-and-forget housekeeping: failures are swallowed
// (returning 0) and must never affect playback or the main sync pipeline.

import { useSettingsStore } from '@/store/settingsStore';
import { resolveCloudSyncGate } from '@/services/sync/cloudSyncProvider';
import type { TTSPackSidecar } from '@/services/tts/providers/sqliteCacheStore';
import { ancestorsOf, buildBookTTSDirPath, buildBookTTSFilePath } from './layout';
import type { FileSyncProvider } from './provider';
import { createFileSyncProvider } from './providerRegistry';

export interface TTSPackSource {
  listPacks(): Promise<{ name: string; size: number }[]>;
  readPackBytes(name: string): Promise<ArrayBuffer | null>;
  buildPackSidecar(name: string): Promise<TTSPackSidecar | null>;
}

export interface TTSPackDestination {
  hasPack(name: string): Promise<boolean>;
  importPack(data: ArrayBuffer, sidecar: TTSPackSidecar): Promise<boolean>;
}

const sidecarNameOf = (packName: string): string => packName.replace(/\.mp3$/, '.json');

const listRemoteNames = async (provider: FileSyncProvider, dir: string): Promise<Set<string>> => {
  try {
    const entries = await provider.list(dir);
    return new Set(entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name));
  } catch {
    // Missing directory (nothing synced yet) or a transient backend error;
    // both read as "remote has nothing".
    return new Set();
  }
};

// Upload local packs the remote does not have. Returns how many packs were
// pushed (a healed missing sidecar counts as a push).
export const pushTTSPacks = async (
  provider: FileSyncProvider,
  bookHash: string,
  source: TTSPackSource,
): Promise<number> => {
  try {
    const local = await source.listPacks();
    if (!local.length) return 0;
    const dir = buildBookTTSDirPath(provider.rootPath, bookHash);
    const remote = await listRemoteNames(provider, dir);
    const missing = local.filter(
      (pack) => !remote.has(pack.name) || !remote.has(sidecarNameOf(pack.name)),
    );
    if (!missing.length) return 0;

    await provider.ensureDir(ancestorsOf(buildBookTTSFilePath(provider.rootPath, bookHash, 'x')));
    let pushed = 0;
    for (const pack of missing) {
      try {
        const sidecar = await source.buildPackSidecar(pack.name);
        if (!sidecar) continue;
        if (!remote.has(pack.name)) {
          const bytes = await source.readPackBytes(pack.name);
          if (!bytes) continue;
          await provider.writeBinary(
            buildBookTTSFilePath(provider.rootPath, bookHash, pack.name),
            bytes,
            'audio/mpeg',
          );
        }
        await provider.writeText(
          buildBookTTSFilePath(provider.rootPath, bookHash, sidecarNameOf(pack.name)),
          JSON.stringify(sidecar),
          'application/json',
        );
        pushed++;
      } catch (err) {
        console.warn('TTS pack push failed for', pack.name, err);
      }
    }
    return pushed;
  } catch (err) {
    console.warn('TTS pack push failed', err);
    return 0;
  }
};

// Import remote packs the device does not have. Returns how many landed.
export const pullTTSPacks = async (
  provider: FileSyncProvider,
  bookHash: string,
  dest: TTSPackDestination,
): Promise<number> => {
  try {
    const dir = buildBookTTSDirPath(provider.rootPath, bookHash);
    const remote = await listRemoteNames(provider, dir);
    let imported = 0;
    for (const name of remote) {
      if (!name.endsWith('.json')) continue;
      const packName = name.replace(/\.json$/, '.mp3');
      try {
        // A sidecar without its mp3 is an incomplete upload: skip.
        if (!remote.has(packName)) continue;
        if (await dest.hasPack(packName)) continue;
        const text = await provider.readText(
          buildBookTTSFilePath(provider.rootPath, bookHash, name),
        );
        if (!text) continue;
        let sidecar: TTSPackSidecar;
        try {
          sidecar = JSON.parse(text) as TTSPackSidecar;
        } catch {
          continue;
        }
        const bytes = await provider.readBinary(
          buildBookTTSFilePath(provider.rootPath, bookHash, packName),
        );
        if (!bytes) continue;
        if (await dest.importPack(bytes, sidecar)) imported++;
      } catch (err) {
        console.warn('TTS pack pull failed for', packName, err);
      }
    }
    return imported;
  } catch (err) {
    console.warn('TTS pack pull failed', err);
    return 0;
  }
};

// The provider pack sync rides: the user's SELECTED third-party file-sync
// backend, honoring the pause gate (#4959). Readest Cloud is deliberately
// excluded — packs live on the user's own storage only.
export const getActiveTTSPackSyncProvider = async (): Promise<FileSyncProvider | null> => {
  try {
    const settings = useSettingsStore.getState().settings;
    const gate = resolveCloudSyncGate(settings);
    // Third-party backends only (Readest Cloud is excluded from packs) and
    // never while the plan has them paused (#4959). Use the highest-priority
    // enabled backend, matching the fixed webdav/gdrive/s3/onedrive order.
    const backend = gate.paused ? undefined : gate.backends[0];
    if (!backend) return null;
    return await createFileSyncProvider(backend, settings);
  } catch {
    return null;
  }
};
