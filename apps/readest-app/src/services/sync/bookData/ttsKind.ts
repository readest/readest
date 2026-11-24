import type {
  SqliteTTSCacheStore,
  TTSPackSidecar,
} from '@/services/tts/providers/sqliteCacheStore';
import { SYNC_BOOK_TTS_DIR } from '@/services/sync/file/layout';
import type { BookDataKind } from './engine';

// Downloaded TTS sections: each pack is `<section>-<keysfp>.mp3` plus a
// `.json` sidecar of its entry offsets, uploaded after the mp3. Only
// downloaded sections are listed (SqliteTTSCacheStore.listPacks).
const sidecarNameOf = (packName: string) => packName.replace(/\.mp3$/, '.json');

export const createTTSBookDataKind = (store: SqliteTTSCacheStore): BookDataKind => ({
  id: SYNC_BOOK_TTS_DIR,
  listLocal: async () => (await store.listPacks()).map((pack) => pack.name),
  filesOf: (unit) => [unit, sidecarNameOf(unit)],
  contentTypeOf: (file) => (file.endsWith('.json') ? 'application/json' : 'audio/mpeg'),
  async readLocal(unit, file) {
    if (file === unit) return store.readPackBytes(unit);
    const sidecar = await store.buildPackSidecar(unit);
    return sidecar
      ? (new TextEncoder().encode(JSON.stringify(sidecar)).buffer as ArrayBuffer)
      : null;
  },
  unitOf: (file) => (file.endsWith('.json') ? file.replace(/\.json$/, '.mp3') : null),
  hasLocal: (unit) => store.hasPack(unit),
  async importUnit(unit, read) {
    const text = await read(sidecarNameOf(unit));
    if (!text) return false;
    let sidecar: TTSPackSidecar;
    try {
      sidecar = JSON.parse(new TextDecoder().decode(text)) as TTSPackSidecar;
    } catch {
      return false;
    }
    const bytes = await read(unit);
    if (!bytes) return false;
    return store.importPack(bytes, sidecar);
  },
});
