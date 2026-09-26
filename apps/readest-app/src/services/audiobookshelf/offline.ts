// Offline copies of Audiobookshelf library entries (#6256). An audiobook's
// tracks land in `Books/<hash>/abs-offline/` next to a manifest written last,
// so the manifest's presence means the download finished. An ebook-only
// item's file lands at the book's managed path, which the reader already
// prefers over streaming (resolveBookContentSource).
//
// Files are streamed to `<file>.part` natively and renamed into place, so a
// half-written file is never mistaken for a finished one, and a retry after a
// failure or cancel skips every file that already landed.

import { rename } from '@tauri-apps/plugin-fs';
import { createAbsClient } from '@/services/audiobookshelf/createClient';
import { downloadFile } from '@/libs/storage';
import { findABSServerById } from '@/store/absServerStore';
import { getAbsOfflineDir, isAbsEbook, parseAbsFilePath } from '@/utils/audiobook';
import { getLocalBookFilename } from '@/utils/book';
import { makeSafeFilename } from '@/utils/misc';
import type { ProgressHandler } from '@/utils/transfer';
import type { ABSChapter, ABSServer, ABSTrack } from '@/types/audiobookshelf';
import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';

export interface AbsOfflineManifest {
  itemId: string;
  duration: number;
  chapters: ABSChapter[];
  /** Each track's `contentUrl` is its file path relative to the Books dir. */
  tracks: ABSTrack[];
}

interface OfflineFile {
  /** Server-relative path, e.g. `/api/items/<id>/file/<ino>`. */
  contentPath: string;
  /** Destination relative to the Books dir. */
  path: string;
  size: number;
}

const getManifestPath = (bookHash: string): string => `${getAbsOfflineDir(bookHash)}/manifest.json`;

export const loadAbsOfflineManifest = async (
  appService: AppService,
  bookHash: string,
): Promise<AbsOfflineManifest | null> => {
  try {
    const text = await appService.readFile(getManifestPath(bookHash), 'Books', 'text');
    return JSON.parse(text as string) as AbsOfflineManifest;
  } catch {
    return null;
  }
};

const isUnauthorized = (error: unknown): boolean =>
  String(error instanceof Error ? error.message : error).includes('status code 401');

export const downloadAbsForOffline = async (
  appService: AppService,
  book: Book,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<void> => {
  const parsed = parseAbsFilePath(book.filePath);
  const server = parsed ? findABSServerById(parsed.serverId) : undefined;
  if (!parsed || !server) throw new Error('Audiobookshelf server not found');
  const client = createAbsClient(appService, server);
  const item = await client.getItemExpanded(parsed.itemId);

  // A metadata edit drops the ABS mirror until the next library sync.
  const ebook = isAbsEbook(book) || book.absMediaType === 'ebook';
  const tracks = ebook ? [] : (item.media.tracks ?? []);
  const files: OfflineFile[] = ebook
    ? [
        {
          contentPath: `/api/items/${encodeURIComponent(parsed.itemId)}/ebook`,
          path: getLocalBookFilename(book),
          size: item.media.ebookFile?.metadata?.size ?? 0,
        },
      ]
    : tracks.map((track, i) => ({
        contentPath: track.contentUrl,
        // Position, not the server's `index`: nothing from the server shapes a path.
        path: `${getAbsOfflineDir(book.hash)}/${i + 1}-${makeSafeFilename(
          track.metadata?.filename ?? track.title ?? 'track',
        )}`,
        size: track.metadata?.size ?? 0,
      }));
  if (files.length === 0) throw new Error('Nothing to download');

  if (!ebook) await appService.createDir(getAbsOfflineDir(book.hash), 'Books', true);

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let doneBytes = 0;
  // Re-read the server row per request: a refresh (ours or the library
  // sync's) rotates the access token mid-download.
  const liveServer = (): ABSServer => findABSServerById(server.id) ?? server;
  for (const file of files) {
    if (signal?.aborted) throw new Error('Download cancelled');
    if (!(await appService.exists(file.path, 'Books'))) {
      const dst = await appService.resolveFilePath(file.path, 'Books');
      const fetchFile = () =>
        downloadFile({
          appService,
          dst: `${dst}.part`,
          cfp: '',
          url: `${liveServer().url}${file.contentPath}`,
          headers: { Authorization: `Bearer ${liveServer().accessToken ?? ''}` },
          // Self-hosted servers often use self-signed certificates; absFetch
          // accepts them too.
          skipSslVerification: true,
          onProgress: (p) =>
            onProgress?.({
              progress: doneBytes + p.progress,
              total: Math.max(totalBytes, doneBytes + p.total),
              transferSpeed: p.transferSpeed,
            }),
        });
      try {
        await fetchFile();
      } catch (error) {
        if (!isUnauthorized(error)) throw error;
        await client.refreshOrRelogin();
        await fetchFile();
      }
      await rename(`${dst}.part`, dst);
    }
    doneBytes += file.size;
  }
  if (signal?.aborted) throw new Error('Download cancelled');

  if (!ebook) {
    const manifest: AbsOfflineManifest = {
      itemId: parsed.itemId,
      duration: item.media.duration ?? tracks.reduce((sum, track) => sum + track.duration, 0),
      chapters: item.media.chapters ?? [],
      tracks: tracks.map((track, i) => ({ ...track, contentUrl: files[i]!.path })),
    };
    await appService.writeFile(getManifestPath(book.hash), 'Books', JSON.stringify(manifest));
  }
};
