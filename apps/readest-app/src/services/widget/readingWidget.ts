import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getCoverFilename } from '@/utils/book';
import { joinScannedPath } from '@/utils/path';
import { coalesceAsync } from '@/utils/coalesceAsync';
import {
  getReadingWidgetInstances,
  setReadingWidgetCatalog,
  updateReadingWidget,
} from '@/utils/bridge';
import type { ReadingWidgetInstance, UpdateReadingWidgetRequest } from '@/utils/bridge';
import {
  selectRecentShelfBooks,
  getProgressPercentage,
  getDisplayedTimeRemaining,
} from '@/app/library/utils/libraryUtils';
import { formatDurationAndPagesLeft, formatDurationLeft } from '@/utils/duration';
import { isAudiobook } from '@/utils/audiobook';
import { getReferencePageInfo, type ReferencePageInfo } from '@/utils/progress';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { resolveBooksDir, type BookshelfWidgetPlayback } from './bookshelfWidget';

const lastPublished = new Map<number, string>();
let lastCatalog = '';

const publishCatalog = async (_: TranslationFunc) => {
  const catalog = {
    labels: {
      title: _('Currently Reading'),
      showHeader: _('Show Header'),
      headerSize: _('Header Size'),
      showTtsBar: _('Text to Speech'),
      referencePages: _('Reference Pages'),
      showPercent: _('Reading Progress'),
      showTimeLeft: _('Remaining Time'),
      showPageCount: _('Page Number'),
      showPagesRemaining: _('Remaining Pages'),
      textSize: _('Font Size'),
      cancel: _('Cancel'),
      save: _('Save'),
    },
  };
  const json = JSON.stringify(catalog);
  if (json === lastCatalog) return;
  try {
    await setReadingWidgetCatalog(catalog);
    lastCatalog = json;
  } catch (err) {
    console.warn('Failed to publish reading widget catalog', err);
  }
};

const medianPageDurationSecsFor = async (
  appService: AppService,
  book: Book,
): Promise<number | undefined> => {
  try {
    const db = await StatisticsDb.open(appService);
    const row = await db.getBookByMd5(book.hash);
    if (!row) return undefined;
    return (await db.getMedianPageDurationSecs(row.id)) ?? undefined;
  } catch (err) {
    console.warn('Failed to read median page duration for reading widget', err);
    return undefined;
  }
};

const refreshReadingWidgetImpl = async (
  appService: AppService,
  _: TranslationFunc,
  playback?: BookshelfWidgetPlayback,
): Promise<void> => {
  // No iOS native implementation of these commands yet.
  if (!appService.isAndroidApp) return;

  // Published even with no widget placed: the configure screen reads it.
  await publishCatalog(_);

  let instances: ReadingWidgetInstance[];
  try {
    ({ instances } = await getReadingWidgetInstances());
  } catch (err) {
    console.warn('Failed to read reading widget instances', err);
    return;
  }
  for (const id of lastPublished.keys()) {
    if (!instances.some((i) => i.appWidgetId === id)) lastPublished.delete(id);
  }
  if (instances.length === 0) return;

  const library = useLibraryStore.getState().library;
  const { settings } = useSettingsStore.getState();
  const isEink = !!settings.globalViewSettings?.isEink;
  const book = selectRecentShelfBooks(library, 1)[0];

  let hash = '';
  let title = '';
  let author = '';
  let percent = 0;
  let coverPath = '';
  let timeLeftMinutes: number | undefined;
  let pagesRemaining = 0;
  let referencePageInfo: ReferencePageInfo | null = null;
  if (book) {
    hash = book.hash;
    title = book.title ?? '';
    author = book.author ?? '';
    percent = getProgressPercentage(book) ?? 0;
    coverPath = joinScannedPath(await resolveBooksDir(appService), getCoverFilename(book));
    // The statistics lookup is only needed when a widget shows the remaining time.
    timeLeftMinutes = instances.some((instance) => instance.showTimeLeft)
      ? getDisplayedTimeRemaining(book, await medianPageDurationSecsFor(appService, book))
      : undefined;
    // An audiobook's progress is in seconds, so it has no page stats.
    pagesRemaining = book.progress && !isAudiobook(book) ? book.progress[1] - book.progress[0] : 0;
    // The footer's reference pages: a book's page list needs the book open, so use the
    // page count saved in its config, read only when a widget asks for it.
    if (book.progress?.[1] && instances.some((instance) => instance.referencePages)) {
      try {
        const config = await appService.loadBookConfig(book, settings);
        referencePageInfo = getReferencePageInfo({
          fraction: book.progress[0] / book.progress[1],
          referencePageCount: config.viewSettings?.referencePageCount,
        });
      } catch (err) {
        console.warn('Failed to load the reference page count for the reading widget', err);
      }
    }
  }

  await Promise.all(
    instances.map(async (instance) => {
      const showTime = !!(book && instance.showTimeLeft && timeLeftMinutes);
      const showPages = !!(book && instance.showPagesRemaining && pagesRemaining > 0);
      // Both enabled: one combined sentence instead of two texts that would each end in "left".
      let remainingText = '';
      if (showTime && showPages) {
        remainingText = formatDurationAndPagesLeft(timeLeftMinutes!, pagesRemaining, _);
      } else if (showTime) {
        remainingText = formatDurationLeft(timeLeftMinutes!, _);
      } else if (showPages) {
        remainingText = _('{{count}} pages left', { count: pagesRemaining });
      }
      const stats = [
        book && instance.showPercent ? _('{{percent}}% Read', { percent }) : '',
        remainingText,
        book && instance.showPageCount && book.progress && !isAudiobook(book)
          ? instance.referencePages && referencePageInfo
            ? `${referencePageInfo.current} / ${referencePageInfo.total}`
            : `${book.progress[0]} / ${book.progress[1]}`
          : '',
      ].filter(Boolean);
      const headerText = instance.showHeader ? _('Currently Reading') : '';
      const tts =
        book && playback && playback.bookHash === hash
          ? { active: playback.active, playing: playback.playing }
          : undefined;
      const request: UpdateReadingWidgetRequest = {
        appWidgetId: instance.appWidgetId,
        hash,
        title,
        author,
        percent,
        coverPath,
        stats,
        headerText,
        emptyTitle: _('Nothing being read right now'),
        isEink,
        ...(tts ? { tts } : {}),
      };
      const fingerprint = JSON.stringify(request);
      if (lastPublished.get(instance.appWidgetId) === fingerprint) return;
      try {
        const { failed } = await updateReadingWidget(request);
        if (failed === 0) lastPublished.set(instance.appWidgetId, fingerprint);
        else lastPublished.delete(instance.appWidgetId);
      } catch (err) {
        lastPublished.delete(instance.appWidgetId);
        console.warn('Failed to update reading widget', instance.appWidgetId, err);
      }
    }),
  );
};

export const refreshReadingWidget = coalesceAsync(refreshReadingWidgetImpl);
