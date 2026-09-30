import type { BookConfig } from '@/types/book';
import { HandwritingEditor } from './editor';
import { HANDWRITING_VERSION, parseHandwriting, type HandwritingDoc } from './model';

/**
 * Handwriting lives on BookConfig (device-local, like the paired audiobook)
 * and is written by the normal saveConfig path. Returns null when the stored
 * ink comes from a newer schema, so the caller can disable editing instead of
 * overwriting data this version cannot read.
 */
export const loadHandwritingEditor = (config: BookConfig): HandwritingEditor | null => {
  const doc = parseHandwriting(config.handwriting);
  return doc ? new HandwritingEditor(doc) : null;
};

export const withHandwriting = (config: BookConfig, editor: HandwritingEditor): BookConfig => {
  const doc = editor.toDocument();
  const { handwriting: _previous, ...rest } = config;
  return Object.keys(doc.pages).length ? { ...rest, handwriting: doc } : rest;
};

/**
 * Merge imported ink into a book's own, per page.
 *
 * Pages are independent (a page key means a specific PDF page or EPUB
 * section), so importing into a book you have already written on must not
 * discard that work. A page the import knows replaces the local one only when
 * the imported copy is newer; pages the file doesn't mention are untouched.
 * Returns null when nothing would change, so callers can skip the save.
 */
export const mergeImportedHandwriting = (
  existing: HandwritingDoc | undefined,
  incoming: HandwritingDoc,
): HandwritingDoc | null => {
  const pages = { ...(existing?.pages ?? {}) };
  let changed = false;
  for (const [key, page] of Object.entries(incoming.pages)) {
    const prev = pages[key];
    if (prev && prev.updatedAt >= page.updatedAt) continue;
    pages[key] = page;
    changed = true;
  }
  return changed ? { version: HANDWRITING_VERSION, pages } : null;
};
