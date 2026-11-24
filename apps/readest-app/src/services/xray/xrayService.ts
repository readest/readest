import { create } from 'zustand';
import { getContextTranslator } from '@/services/dictionaries/providers/contextProvider';
import environmentConfig from '@/services/environment';
import { onDeviceInputChars, prepareOnDevice } from '@/services/translators/custom/onDevice';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { useReaderStore } from '@/store/readerStore';
import { getSignedInToken, isCustomTranslatorAllowed } from '@/utils/access';
import { getTargetLang } from '@/utils/misc';
import { readPassages, type XRayPassage } from './bookText';
import { extractXRay } from './extract';
import { findMentions, type XRayMentions } from './mentions';
import { checkpointXRay, clearXRay, getXRay, getXRayEnd, saveXRayBatch } from './store';
import type { XRayData } from './types';

/** Book text in one request: enough for names and events to repeat within it. */
const BATCH_CHARS = 12_000;
/** Names already in the X-Ray to send with it, the latest ones. */
const KNOWN_NAMES = 200;

interface XRayState {
  /** Books being read into the X-Ray, or whose last update failed. */
  updates: Record<string, { running: boolean; error?: string }>;
  /** Bumped when an X-Ray changes. */
  revision: number;
  /** The latest lookup with the X-Ray tool, for the Notebook's tab. */
  lookup: { word: string; id: number } | null;
  /** The X-Ray tab is on screen, so its lookups show there instead of in a popup. */
  isDocked: boolean;
}

export const useXRayStore = create<XRayState>(() => ({
  updates: {},
  revision: 0,
  lookup: null,
  isDocked: false,
}));

export const setXRayLookup = (word: string) =>
  useXRayStore.setState(({ lookup }) => ({ lookup: { word, id: (lookup?.id ?? 0) + 1 } }));

/** The X-Ray asks the Context Dictionary's AI translator, on the same terms. */
export const isXRayAvailable = () =>
  isCustomTranslatorAllowed(getSignedInToken()) && !!getContextTranslator();

const bookHashOf = (bookKey: string) => bookKey.split('-')[0]!;

const bump = () => useXRayStore.setState(({ revision }) => ({ revision: revision + 1 }));

/** The X-Ray of an open book, up to its current page. */
export const getBookXRay = async (bookKey: string): Promise<XRayData | null> => {
  const location = getBookProgress(bookKey)?.location;
  if (!location) return null;
  return getXRay(await environmentConfig.getAppService(), bookHashOf(bookKey), location);
};

/** Where an open book mentions any of `names`, up to its current page. Asks no AI. */
export const getBookMentions = async (
  bookKey: string,
  names: readonly string[],
  limit: number,
): Promise<XRayMentions> => {
  const location = getBookProgress(bookKey)?.location;
  const bookDoc = useBookDataStore.getState().getBookData(bookKey)?.bookDoc;
  if (!location || !bookDoc) return { count: 0, quotes: [] };
  return findMentions(bookDoc, location, names, limit);
};

export const openQuote = (bookKey: string, cfi: string) =>
  useReaderStore.getState().getView(bookKey)?.goTo(cfi);

const controllers = new Map<string, AbortController>();

export const stopXRayUpdate = (bookKey: string) => controllers.get(bookHashOf(bookKey))?.abort();

/** Forgets a book's X-Ray, once the reader confirms `question`. */
export const clearBookXRay = async (bookKey: string, question: string): Promise<void> => {
  const appService = await environmentConfig.getAppService();
  if (!(await appService.ask(question))) return;
  stopXRayUpdate(bookKey);
  await clearXRay(appService, bookHashOf(bookKey));
  bump();
};

/**
 * Reads the book into its X-Ray, from where that ends to the current page.
 * `wholeBatches` leaves a remainder for later rather than ask the AI about a
 * page or two.
 */
export const updateXRay = async (
  bookKey: string,
  { wholeBatches = false }: { wholeBatches?: boolean } = {},
): Promise<void> => {
  const bookHash = bookHashOf(bookKey);
  const translator = getContextTranslator();
  const location = getBookProgress(bookKey)?.location;
  const { book, bookDoc } = useBookDataStore.getState().getBookData(bookKey) ?? {};
  if (!isXRayAvailable() || !translator || !location || !book || !bookDoc) return;
  if (controllers.has(bookHash)) return;

  const controller = new AbortController();
  const { signal } = controller;
  controllers.set(bookHash, controller);
  const setUpdate = (update: XRayState['updates'][string]) =>
    useXRayStore.setState(({ updates }) => ({ updates: { ...updates, [bookHash]: update } }));
  let error: string | undefined;
  try {
    const appService = await environmentConfig.getAppService();
    const targetLang =
      useReaderStore.getState().getViewSettings(bookKey)?.translateTargetLang || getTargetLang();
    const batchChars =
      translator.type === 'apple-intelligence'
        ? onDeviceInputChars((await prepareOnDevice(targetLang)).contextSize)
        : BATCH_CHARS;
    const input = {
      bookTitle: book.title,
      bookAuthor: book.author,
      sourceLang: book.primaryLanguage || 'AUTO',
      targetLang,
    };
    const { position, names } = await getXRayEnd(appService, bookHash);
    const known = new Set(names);
    let batch: XRayPassage[] = [];
    let chars = 0;
    const flush = async () => {
      setUpdate({ running: true });
      const last = batch.at(-1)!;
      const recent = [...known].slice(-KNOWN_NAMES);
      const data = await extractXRay(translator, batch, recent, input, signal);
      await saveXRayBatch(appService, bookHash, {
        position: last.position,
        endCfi: last.cfiAt(last.text.length),
        data,
      });
      for (const { name } of data.entities) known.add(name);
      bump();
      batch = [];
      chars = 0;
    };
    for await (const passage of readPassages(bookDoc, position, location)) {
      signal.throwIfAborted();
      if (batch.length && chars + passage.text.length > batchChars) await flush();
      batch.push(passage);
      chars += passage.text.length;
    }
    if (batch.length && !wholeBatches) await flush();
    if (known.size > names.length) await checkpointXRay(appService);
  } catch (err) {
    if (!signal.aborted) error = err instanceof Error ? err.message : String(err);
  } finally {
    controllers.delete(bookHash);
    setUpdate({ running: false, error });
  }
};
