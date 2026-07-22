import { invoke } from '@tauri-apps/api/core';
import type { ConvertInput } from '@/services/send/conversion/convertToEpub';
import type { ConvertedBook } from '@/services/send/conversion/types';
import { convertToEpubWithWorker } from '@/services/send/conversion/conversionWorker';
import { getClipOptions } from '@/services/send/clipOptions';
import { ingestFile } from '@/services/ingestService';
import { isTauriAppPlatform } from '@/services/environment';
import { md5Fingerprint } from '@/utils/md5';
import { stubTranslation as _ } from '@/utils/misc';
import type { AppService } from '@/types/system';
import type { SystemSettings } from '@/types/settings';
import type { Book } from '@/types/book';
import type { RssFeed, RssFeedItem } from '@/types/rss';

const MIN_FEED_CONTENT = 200;

export function resolveArticleInput(item: RssFeedItem, pageHtml: string | null): ConvertInput {
  if (item.contentHtml && item.contentHtml.length >= MIN_FEED_CONTENT) {
    return { kind: 'article', html: item.contentHtml, url: item.link };
  }
  if (pageHtml) {
    return { kind: 'page', html: pageHtml, url: item.link };
  }
  throw new Error(_('This article has no full content; open it in a browser.'));
}

export interface OpenFeedArticleParams {
  item: RssFeedItem;
  feed: RssFeed;
  books: Book[];
  appService: AppService;
  settings: SystemSettings;
  isLoggedIn: boolean;
  translate: (key: string) => string;
  /** Injectable seams for testing; default to the real collaborators. */
  clip?: (url: string, options: unknown) => Promise<string>;
  convert?: (input: ConvertInput) => Promise<ConvertedBook>;
  ingest?: typeof ingestFile;
}

export async function openFeedArticle(params: OpenFeedArticleParams): Promise<Book> {
  const {
    item,
    feed,
    books,
    appService,
    settings,
    isLoggedIn,
    translate,
    clip = (url, options) => invoke<string>('clip_url', { url, options }),
    convert = convertToEpubWithWorker,
    ingest = ingestFile,
  } = params;

  let pageHtml: string | null = null;
  const needsPage = !item.contentHtml || item.contentHtml.length < MIN_FEED_CONTENT;
  if (needsPage && isTauriAppPlatform()) {
    pageHtml = await clip(item.link, getClipOptions(translate));
  }

  const converted = await convert(resolveArticleInput(item, pageHtml));
  const book = await ingest(
    {
      file: converted.file,
      books,
      groupId: md5Fingerprint(feed.title),
      groupName: feed.title,
      forceUpload: true,
    },
    { appService, settings, isLoggedIn },
  );
  if (!book) throw new Error(_('Import produced no book'));
  return book;
}

export interface HandleOpenDeps {
  openArticle: typeof openFeedArticle;
  updateBooks: (books: Book[]) => Promise<void>;
  markRead: () => void;
  navigate: (hash: string) => void;
  onError: (message: string) => void;
}

export async function handleOpenArticle(
  params: OpenFeedArticleParams,
  deps: HandleOpenDeps,
): Promise<void> {
  try {
    const book = await deps.openArticle(params);
    await deps.updateBooks([book]);
    deps.markRead();
    deps.navigate(book.hash);
  } catch (err) {
    deps.onError(err instanceof Error ? err.message : String(err));
  }
}
