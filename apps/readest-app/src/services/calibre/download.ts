import type { AppService } from '@/types/system';
import type { Book } from '@/types/book';
import type { ProgressHandler } from '@/utils/transfer';
import { createCalibreClient } from '@/services/calibre/client';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { downloadFile } from '@/libs/storage';
import { needsProxy, probeAuth } from '@/app/opds/utils/opdsReq';
import { buildDownloadLadder, resolveCalibreIdentity } from '@/utils/calibre';
import { getLocalBookFilename } from '@/utils/book';
import { uniqueId } from '@/utils/misc';
import { findCalibreServerById } from '@/store/calibreServerStore';

interface DownloadCalibreBookOptions {
  onProgress?: ProgressHandler;
  /** Pick a specific format instead of the row's preferred one (lowercase ext). */
  format?: string;
}

/** True for a server 404: that format's data/file isn't there, another format may be. */
const isNotFound = (error: unknown): boolean =>
  /\b404\b|not found/i.test(error instanceof Error ? error.message : String(error));

export interface CalibreDownloadResult {
  ok: boolean;
  /**
   * True when every attempted format answered 404: the server's database
   * advertises the formats but the actual files are missing on the server
   * (calibre-web's send_from_directory 404s exactly like that). Nothing a
   * retry or a different format can fix — the book needs fixing server-side.
   */
  missingOnServer?: boolean;
}

/**
 * Download a Calibre book's file into its managed shelf directory
 * (`Books/<hash>/<title>.<ext>`) so the SAME library row that carried the
 * sync stub becomes the readable book: hash, progress, notes, and config
 * keys all stay stable, and `resolveBookContentSource` finds a managed file
 * on the next open without any re-import or stub-replacement dance.
 *
 * Formats are tried as a ladder — preferred first, then the rest of the
 * server-advertised formats in preference order. A 404 (Calibre-Web answers
 * 404 when the advertised format has no data/file on the server) drops to
 * the next format; any other failure stops. On success the synthetic
 * `calibre://` filePath is cleared and the row's format follows the format
 * that actually downloaded, so the managed filename and EXTS lookups stay
 * consistent. Works for both stubs and previously downloaded copies whose
 * local file was deleted (identity via metadata.calibreSource).
 */
export const downloadCalibreBook = async (
  appService: AppService,
  book: Book,
  options: DownloadCalibreBookOptions = {},
): Promise<CalibreDownloadResult> => {
  if (await appService.exists(getLocalBookFilename(book), 'Books')) {
    book.downloadedAt = book.downloadedAt ?? Date.now();
    book.filePath = undefined;
    return { ok: true };
  }
  const identity = resolveCalibreIdentity(book);
  if (!identity) return { ok: false };
  const server = findCalibreServerById(identity.serverId);
  if (!server || server.deletedAt) return { ok: false };
  const source = book.metadata?.calibreSource;
  const ladder = buildDownloadLadder(options.format ?? source?.format, source?.formats);
  if (ladder.length === 0) return { ok: false };

  const client = createCalibreClient(server);
  let sawNotFound = false;
  let sawOtherError = false;
  for (const [index, format] of ladder.entries()) {
    const url = client.buildDownloadUrl(identity.libraryId, identity.bookId, format);
    const headers: Record<string, string> = {
      'User-Agent': READEST_OPDS_USER_AGENT,
      Accept: '*/*',
    };
    if (server.username && server.password) {
      // probeAuth answers the challenge for THIS exact url; a Digest header
      // is bound to its request uri, so it must be minted per download.
      const auth = await probeAuth(url, server.username, server.password, needsProxy(url));
      if (auth) headers['Authorization'] = auth;
    }
    // Land in Cache first, then copy into the managed shelf dir: the
    // transfer manager writes wherever resolveFilePath points on every
    // platform, but the web filesystem only accepts base-relative targets
    // through copyFile.
    const dstTmp = await appService.resolveFilePath(`calibre_${uniqueId()}.${format}`, 'Cache');
    try {
      await downloadFile({
        appService,
        dst: dstTmp,
        cfp: '',
        url,
        headers,
        singleThreaded: true,
        skipSslVerification: true,
        onProgress: options.onProgress,
      });
      // Follow the format that actually downloaded: the managed filename,
      // the format badge, and every EXTS[format] lookup derive from it.
      // The format fields are only committed after the copy succeeds —
      // a failed copyFile (disk, permissions) must leave the book pointing
      // at its previous format, and the next ladder rung must derive its
      // target filename from the candidate format, not a mutated one.
      const nextFormat = format.toUpperCase() as Book['format'];
      await appService.copyFile(
        dstTmp,
        'None',
        getLocalBookFilename({ ...book, format: nextFormat }),
        'Books',
      );
      book.format = nextFormat;
      if (book.metadata?.calibreSource) {
        book.metadata.calibreSource = { ...book.metadata.calibreSource, format };
      }
      book.downloadedAt = Date.now();
      // The calibre:// path is an identity for a fileless stub; once the real
      // file is in the managed shelf dir it would only misroute availability
      // checks, cloud sync, and reconcile. calibreSource keeps the identity.
      book.filePath = undefined;
      return { ok: true };
    } catch (error) {
      const isLast = index === ladder.length - 1;
      if (isNotFound(error)) {
        sawNotFound = true;
      } else {
        sawOtherError = true;
      }
      if (isLast || !isNotFound(error)) {
        const path = (() => {
          try {
            return new URL(url).pathname;
          } catch {
            return url;
          }
        })();
        console.error(`[Calibre] download failed for "${book.title}": GET ${path}`, error);
        return { ok: false, missingOnServer: sawNotFound && !sawOtherError };
      }
      // The advertised format isn't on the server; fall to the next one.
      console.warn(
        `[Calibre] format "${format}" not available for "${book.title}", trying the next one`,
      );
    } finally {
      try {
        await appService.deleteFile(dstTmp, 'None');
      } catch {
        // best effort cleanup
      }
    }
  }
  return { ok: false, missingOnServer: sawNotFound && !sawOtherError };
};
