import * as CFI from 'foliate-js/epubcfi.js';
import type { Book, BookNote } from '@/types/book';
import type { AppService } from '@/types/system';
import { buildAnnotationWebUrl } from '@/utils/deeplink';
import { makeSafeFilename } from '@/utils/misc';
import { getCoverFilename } from '@/utils/book';
import {
  createVaultNote,
  mergeVaultNote,
  type VaultBook,
  type VaultHighlight,
  type WrittenBlocks,
} from './vaultNote';

/** Per device: which vault note holds the book, and what this device wrote into it. */
interface VaultBookState {
  file: string;
  written: WrittenBlocks;
}

const COVERS_DIR = 'covers';
const statePath = (bookHash: string) => `obsidian/${bookHash}.json`;

const readState = async (appService: AppService, bookHash: string): Promise<VaultBookState> => {
  try {
    const raw = await appService.readFile(statePath(bookHash), 'Settings', 'text');
    const parsed = JSON.parse(raw as string) as Partial<VaultBookState>;
    return { file: parsed.file ?? '', written: parsed.written ?? {} };
  } catch {
    return { file: '', written: {} };
  }
};

// A note the user renamed or moved inside the folder, or one another device
// created, is found again by its `readest_book_id` property.
const findNote = async (appService: AppService, folder: string, bookHash: string) => {
  const files = await appService.readDirectory(folder, 'None', ['md']);
  for (const { path } of files) {
    if (!path.endsWith('.md')) continue;
    const text = (await appService.readFile(`${folder}/${path}`, 'None', 'text')) as string;
    if (new RegExp(`^readest_book_id:\\s*${bookHash}\\s*$`, 'm').test(text)) return path;
  }
  return '';
};

const newNoteFile = async (appService: AppService, folder: string, title: string) => {
  const base = makeSafeFilename(title.replace(/[[\]^|]/g, ''), ' ').trim() || 'Untitled';
  for (let n = 1; ; n++) {
    const file = n === 1 ? `${base}.md` : `${base} ${n}.md`;
    if (!(await appService.exists(`${folder}/${file}`, 'None'))) return file;
  }
};

const copyCover = async (appService: AppService, folder: string, book: Book) => {
  const name = `${book.hash}.png`;
  try {
    if (!(await appService.exists(getCoverFilename(book), 'Books'))) return null;
    await appService.createDir(`${folder}/${COVERS_DIR}`, 'None');
    await appService.copyFile(
      getCoverFilename(book),
      'Books',
      `${folder}/${COVERS_DIR}/${name}`,
      'None',
    );
    return name;
  } catch (error) {
    console.warn('Obsidian: could not copy the cover', error);
    return null;
  }
};

export const toVaultHighlights = (
  bookHash: string,
  notes: BookNote[],
  chapterForNote: (note: BookNote) => string | null,
): VaultHighlight[] =>
  notes
    .filter((note) => note.type === 'annotation' || note.type === 'excerpt')
    .sort((a, b) => CFI.compare(a.cfi, b.cfi))
    .map((note) => ({
      id: note.id,
      text: note.text ?? '',
      note: note.note ?? '',
      color: note.color ?? 'yellow',
      chapter: chapterForNote(note),
      url: buildAnnotationWebUrl({ bookHash, noteId: note.id, cfi: note.cfi }),
      deleted: !!note.deletedAt || !note.text,
    }));

/**
 * Write the book's highlights into its note in `folder`, creating the note if
 * needed. Returns how many highlights it added, rewrote or removed.
 */
export const syncBookToVault = async (
  appService: AppService,
  folder: string,
  book: Book,
  progress: [number, number] | undefined,
  highlights: VaultHighlight[],
): Promise<number> => {
  const state = await readState(appService, book.hash);
  if (!state.file && !highlights.some((h) => !h.deleted)) return 0;
  const vaultBook: VaultBook = {
    hash: book.hash,
    title: book.title,
    author: book.author,
    progress: progress?.[1] ? Math.round((progress[0] / progress[1]) * 100) : null,
    cover: null,
  };

  let file =
    state.file && (await appService.exists(`${folder}/${state.file}`, 'None'))
      ? state.file
      : await findNote(appService, folder, book.hash);
  let existing: string;
  if (file) {
    existing = (await appService.readFile(`${folder}/${file}`, 'None', 'text')) as string;
  } else {
    file = await newNoteFile(appService, folder, book.title);
    vaultBook.cover = await copyCover(appService, folder, book);
    existing = createVaultNote(vaultBook);
    state.written = {};
  }

  const { text, written, changed } = mergeVaultNote(existing, vaultBook, highlights, state.written);
  if (text !== existing) await appService.writeFile(`${folder}/${file}`, 'None', text);
  await appService.createDir('obsidian', 'Settings');
  await appService.writeFile(statePath(book.hash), 'Settings', JSON.stringify({ file, written }));
  return changed;
};
