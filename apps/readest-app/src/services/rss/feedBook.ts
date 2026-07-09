import { md5 } from '@/utils/md5';
import { buildFeedBookUrl } from './feedBookUrl';
import { generateCoverSvg } from '@/services/send/conversion/coverGenerator';
import type { ParsedFeed } from '@/types/rss';
import type { Book } from '@/types/book';
import type { EpubImage } from '@/services/send/conversion/types';

// The classic feed icon (Wikimedia Commons "Generic Feed-icon.svg" geometry):
// orange gradient rounded square with the white broadcast dot and two arcs.
const RSS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="a" x1="0.085" y1="0.085" x2="0.915" y2="0.915"><stop offset="0" stop-color="#E3702D"/><stop offset="0.1071" stop-color="#EA7D31"/><stop offset="0.3503" stop-color="#F69537"/><stop offset="0.5" stop-color="#FB9E3A"/><stop offset="0.7016" stop-color="#EA7C31"/><stop offset="0.8866" stop-color="#DE642B"/><stop offset="1" stop-color="#D95B29"/></linearGradient></defs><rect width="256" height="256" rx="55" fill="#CC5D15"/><rect x="12" y="12" width="232" height="232" rx="44" fill="url(#a)"/><circle cx="68" cy="189" r="24" fill="#FFF"/><path d="M160 213h-34a82 82 0 0 0-82-82V97a116 116 0 0 1 116 116z" fill="#FFF"/><path d="M184 213A140 140 0 0 0 44 73V38a175 175 0 0 1 175 175z" fill="#FFF"/></svg>`;

export function feedBookHash(feedUrl: string): string {
  return md5(buildFeedBookUrl(feedUrl));
}

export function generateFeedCoverSvg(feedUrl: string, title: string): EpubImage {
  const iconBytes = new TextEncoder().encode(RSS_ICON_SVG);
  let siteName = '';
  try {
    siteName = new URL(feedUrl).hostname.replace(/^www\./, '');
  } catch {
    siteName = '';
  }
  return generateCoverSvg({
    title,
    siteName,
    authorImage: {
      bytes: iconBytes.buffer as ArrayBuffer,
      mime: 'image/svg+xml',
    },
  });
}

export function createFeedBook(feedUrl: string, parsed: ParsedFeed): Book {
  const now = Date.now();
  return {
    hash: feedBookHash(feedUrl),
    url: buildFeedBookUrl(feedUrl),
    format: 'EPUB',
    title: parsed.title,
    author: '',
    metadata: { title: parsed.title, author: '', language: '', feedUrl },
    createdAt: now,
    updatedAt: now,
    downloadedAt: now,
    uploadedAt: null,
    deletedAt: null,
  };
}
