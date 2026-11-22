import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import { type CustomFont, getFontFormat, getMimeType } from '@/styles/fonts';
import { migrateLegacyFonts, useCustomFontStore } from '@/store/customFontStore';
import { getFilename } from '@/utils/path';
import { uniqueId } from '@/utils/misc';
import type { FileSyncProvider } from './provider';
import type { SyncStrategy } from './engine';
import { ancestorsOf, buildFontDirPath, buildFontsIndexPath } from './layout';

/** One custom font in `Readest/fonts.json`, keyed by the font's contentId. */
export interface RemoteFont {
  contentId: string;
  filename: string;
  name: string;
  family?: string;
  style?: string;
  weight?: number;
  variable?: boolean;
  byteSize?: number;
  /** When the font was imported, or imported again after a delete. */
  addedAt: number;
  /** A tombstone, so a delete reaches devices that still list the font. */
  deletedAt?: number;
}

export interface RemoteFontIndex {
  schemaVersion: 1;
  fonts: RemoteFont[];
  updatedAt: number;
}

// One plain path segment, so a listed font never leads outside its folder.
const isPlainName = (name: unknown) =>
  typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name);

const parseFontIndex = (raw: string | null): RemoteFont[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RemoteFontIndex;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.fonts)) return [];
    return parsed.fonts.filter((f) => isPlainName(f.contentId) && isPlainName(f.filename));
  } catch {
    return [];
  }
};

const uploadFont = async (
  provider: FileSyncProvider,
  appService: AppService,
  font: CustomFont,
): Promise<RemoteFont> => {
  const contentId = font.contentId!;
  const filename = getFilename(font.path);
  const dir = buildFontDirPath(provider.rootPath, contentId);
  const bytes = (await appService.readFile(font.path, 'Fonts', 'binary')) as ArrayBuffer;
  await provider.ensureDir([...ancestorsOf(dir), dir]);
  await provider.writeBinary(`${dir}/${filename}`, bytes, getMimeType(getFontFormat(filename)));
  return {
    contentId,
    filename,
    name: font.name,
    family: font.family,
    style: font.style,
    weight: font.weight,
    variable: font.variable,
    byteSize: font.byteSize ?? bytes.byteLength,
    addedAt: font.downloadedAt ?? Date.now(),
  };
};

/** A font from another device, listed here and downloaded when picked. */
const toPlaceholder = (entry: RemoteFont, local?: CustomFont): CustomFont => {
  const bundleDir = local?.bundleDir ?? uniqueId();
  return {
    id: local?.id ?? bundleDir,
    name: entry.name,
    family: entry.family,
    style: entry.style,
    weight: entry.weight,
    variable: entry.variable,
    byteSize: entry.byteSize,
    contentId: entry.contentId,
    bundleDir,
    path: `${bundleDir}/${entry.filename}`,
    downloadedAt: entry.addedAt,
    unavailable: true,
  };
};

// The same file can be listed twice (a Readest Cloud placeholder and a
// re-import of it): a live copy with its file here speaks for the font.
const rank = (font: CustomFont) => (font.deletedAt ? 0 : font.unavailable ? 1 : 2);

/**
 * One backend's font pass. Fonts match by contentId, so a font that also came
 * through Readest Cloud is not listed twice. The latest of a font's import and
 * delete wins on both sides: a delete here frees the remote copy, and a
 * re-import after a delete uploads the file again. Fonts from other devices
 * land as placeholders; {@link downloadFont} fetches one when it is picked.
 */
export const syncFonts = async (
  envConfig: EnvConfigType,
  provider: FileSyncProvider,
  strategy: SyncStrategy,
): Promise<void> => {
  const appService = await envConfig.getAppService();
  // Hydrate first, as the Readest Cloud pull does: applying a remote font saves
  // the store over settings.customFonts.
  await useCustomFontStore.getState().loadCustomFonts(envConfig);
  await migrateLegacyFonts(envConfig);

  const indexPath = buildFontsIndexPath(provider.rootPath);
  const entries = new Map(
    parseFontIndex(await provider.readText(indexPath)).map((entry) => [entry.contentId, entry]),
  );
  const local = new Map<string, CustomFont>();
  for (const font of useCustomFontStore.getState().fonts) {
    if (!font.contentId) continue;
    const known = local.get(font.contentId);
    if (!known || rank(font) > rank(known)) local.set(font.contentId, font);
  }

  let changed = false;
  // Fonts deleted here, with the entry each replaces. A folder is removed only
  // if the delete is still the latest event when fonts.json is committed.
  const removed = new Map<string, RemoteFont>();
  if (strategy !== 'receive') {
    for (const [contentId, font] of local) {
      const entry = entries.get(contentId);
      try {
        if (font.deletedAt) {
          if (!entry || entry.deletedAt || font.deletedAt <= entry.addedAt) continue;
          entries.set(contentId, { ...entry, deletedAt: font.deletedAt });
          removed.set(contentId, entry);
        } else {
          if (font.unavailable) continue;
          // A live entry is left alone, even for a newer import here: listing
          // it without uploading could leave an entry with no file if a delete
          // raced it. If an older delete wins, the next pass uploads again.
          if (entry && (!entry.deletedAt || entry.deletedAt > (font.downloadedAt ?? 0))) continue;
          entries.set(contentId, await uploadFont(provider, appService, font));
        }
        changed = true;
      } catch (e) {
        console.warn('[cloudSync] font push failed', font.name, e);
      }
    }
  }

  if (strategy !== 'send') {
    const store = useCustomFontStore.getState();
    for (const entry of entries.values()) {
      const font = local.get(entry.contentId);
      if (entry.deletedAt) {
        if (font && !font.deletedAt && entry.deletedAt > (font.downloadedAt ?? 0)) {
          store.softDeleteByContentId(entry.contentId, entry.deletedAt);
        }
      } else if (!font || (font.deletedAt && entry.addedAt > font.deletedAt)) {
        store.applyRemoteFont(toPlaceholder(entry, font));
      }
    }
  }

  if (!changed) return;
  // A peer may have written fonts.json since the read: keep its entries where
  // they are the later event, so its deletes and imports survive this write.
  const eventAt = (entry: RemoteFont) => entry.deletedAt ?? entry.addedAt;
  for (const fresh of parseFontIndex(await provider.readText(indexPath))) {
    const ours = entries.get(fresh.contentId);
    if (!ours || eventAt(fresh) > eventAt(ours)) entries.set(fresh.contentId, fresh);
  }
  for (const [contentId, listed] of removed) {
    const entry = entries.get(contentId);
    // A peer's newer import won: its file stays.
    if (!entry?.deletedAt) continue;
    try {
      await provider.deleteDir(buildFontDirPath(provider.rootPath, contentId));
    } catch (e) {
      console.warn('[cloudSync] font delete failed', contentId, e);
      // Leave this device's delete unlisted, so the next pass tries again.
      if (entry.deletedAt === local.get(contentId)?.deletedAt) entries.set(contentId, listed);
    }
  }
  const index: RemoteFontIndex = {
    schemaVersion: 1,
    fonts: [...entries.values()],
    updatedAt: Date.now(),
  };
  await provider.ensureDir(ancestorsOf(indexPath));
  await provider.writeText(indexPath, JSON.stringify(index));
};

/** Fetch a placeholder font's file into its bundle dir. False when the remote lacks it. */
export const downloadFont = async (
  provider: FileSyncProvider,
  appService: AppService,
  font: CustomFont,
): Promise<boolean> => {
  if (!font.contentId || !font.bundleDir) return false;
  const dir = buildFontDirPath(provider.rootPath, font.contentId);
  const bytes = await provider.readBinary(`${dir}/${getFilename(font.path)}`);
  if (!bytes) return false;
  await appService.createDir(font.bundleDir, 'Fonts', true);
  await appService.writeFile(font.path, 'Fonts', bytes);
  return true;
};
