import { md5 } from 'js-md5';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { OPDSGenericLink } from '@/types/opds';
import { REL } from '@/types/opds';
import { downloadFile } from '@/libs/storage';
import { getProxiedURL, needsProxy, probeAuth } from '@/app/opds/utils/opdsReq';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { getCoverFilename } from '@/utils/book';
import { uniqueId } from '@/utils/misc';

/**
 * Exact-match a link's rel tokens. Substring matching is wrong here:
 * `http://opds-spec.org/image/thumbnail` contains `http://opds-spec.org/image`,
 * so a naive `includes` would accept the thumbnail as the full-size cover.
 */
const matchesRel = (link: OPDSGenericLink, rels: readonly string[]) => {
  const linkRels = Array.isArray(link.rel) ? link.rel : (link.rel ?? '').split(/\s+/);
  return linkRels.some((rel) => rels.includes(rel));
};

/**
 * The href of the artwork an OPDS entry advertises for itself, or undefined
 * when it advertises none. Catalogs that let users replace a book's cover
 * (Calibre-Web Automated and friends) publish the replacement here while the
 * EPUB/PDF file still carries the original, so this is the cover the library
 * should show (issue #5270).
 *
 * Prefers the full-size `rel="…/image"` link, then the thumbnail, then
 * whatever image came first. The href is returned as-is — resolve it against
 * the feed's base URL before fetching.
 */
export const getOPDSCoverHref = (publication: {
  // Optional at runtime: feeds without artwork parse to an entry with no
  // `images`, and the detail-document merge can drop it.
  images?: OPDSGenericLink[];
}): string | undefined => {
  const images = publication.images ?? [];
  const cover =
    images.find((img) => matchesRel(img, REL.COVER) && img.href) ??
    images.find((img) => matchesRel(img, REL.THUMBNAIL) && img.href) ??
    images.find((img) => img.href);
  return cover?.href;
};

/**
 * Cache filename for a downloaded OPDS image. Some catalogs replace the cover
 * bytes at an unchanged URL and only advance the entry's Atom `<updated>`
 * value, so when the entry carries one it participates in the key and the
 * replacement invalidates the cached file (issue #5492). Entries without
 * `<updated>` keep the historical URL-only key, so their existing cache files
 * stay valid.
 */
export const getOPDSImageCacheFilename = (url: string, updated?: string): string =>
  `img_${md5(updated ? `${url}\n${updated}` : url)}.png`;

interface ApplyOPDSCoverParams {
  appService: AppService;
  /** Imported book; its `coverHash`/`coverImageUrl` are updated in place. */
  book: Book;
  /** Absolute URL of the cover advertised by the OPDS entry. */
  coverUrl: string;
  username?: string;
  password?: string;
  customHeaders?: Record<string, string>;
}

/**
 * Replace an imported book's cover with the one the OPDS entry advertises.
 *
 * Best effort: any failure (offline, 404, empty body) leaves the cover
 * extracted from the book file in place and returns false, so a catalog
 * without usable artwork never degrades the import.
 */
export const applyOPDSCover = async ({
  appService,
  book,
  coverUrl,
  username = '',
  password = '',
  customHeaders = {},
}: ApplyOPDSCoverParams): Promise<boolean> => {
  const useProxy = needsProxy(coverUrl);
  let downloadUrl = useProxy ? getProxiedURL(coverUrl, '', true, customHeaders) : coverUrl;
  const headers: Record<string, string> = {
    'User-Agent': READEST_OPDS_USER_AGENT,
    Accept: 'image/*',
    ...(!useProxy ? customHeaders : {}),
  };
  if (username || password) {
    const authHeader = await probeAuth(coverUrl, username, password, useProxy, customHeaders);
    if (authHeader) {
      if (!useProxy) {
        headers['Authorization'] = authHeader;
      }
      downloadUrl = useProxy ? getProxiedURL(coverUrl, authHeader, true, customHeaders) : coverUrl;
    }
  }

  const tmpPath = await appService.resolveFilePath(`opds_cover_${uniqueId()}`, 'Cache');
  try {
    await downloadFile({
      appService,
      dst: tmpPath,
      cfp: '',
      url: downloadUrl,
      headers,
      singleThreaded: true,
      // Same self-signed/private-CA workaround the book download uses (#4988).
      skipSslVerification: true,
    });
    const bytes = (await appService.readFile(tmpPath, 'None', 'binary')) as ArrayBuffer;
    if (!bytes?.byteLength) return false;
    await appService.writeFile(getCoverFilename(book), 'Books', bytes);
  } catch (error) {
    console.warn('[OPDS] failed to apply the feed cover:', error);
    return false;
  } finally {
    try {
      await appService.deleteFile(tmpPath, 'None');
    } catch {
      // best effort cache cleanup
    }
  }

  // Keep coverHash === partialMD5(cover.png) so cross-device cover sync still
  // sees the truth (issue #4544), and refresh the URL the library renders from
  // — on web it is a blob URL bound to the bytes we just replaced.
  book.coverHash = await appService.computeCoverHash(book);
  book.coverImageUrl = await appService.generateCoverImageUrl(book);
  return true;
};
