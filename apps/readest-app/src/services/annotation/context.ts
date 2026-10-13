import { BookDoc } from '@/libs/document';
import { BookNote } from '@/types/book';
import { getSentenceBounds } from '@/utils/sentence';
import { resolveCfi } from './providers/readest';

const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The sentence surrounding each highlight, read from the book at export time
 * so nothing extra is stored on the note (#6352). Keyed by note id; notes that
 * don't resolve, or whose highlight already is the whole sentence, are omitted.
 */
export const getAnnotationContexts = async (
  bookDoc: BookDoc,
  notes: BookNote[],
): Promise<Record<string, string>> => {
  const docs = new Map<number, Promise<Document>>();
  const contexts: Record<string, string> = {};
  for (const note of notes) {
    if (!note.text) continue;
    try {
      const resolved = resolveCfi(bookDoc, note.cfi);
      const section = resolved ? bookDoc.sections?.[resolved.index] : undefined;
      if (!resolved?.anchor || !section) continue;
      if (!docs.has(resolved.index)) docs.set(resolved.index, section.createDocument());
      const range = resolved.anchor(await docs.get(resolved.index)!);
      if (typeof range === 'number') continue;
      const bounds = getSentenceBounds(range);
      if (!bounds) continue;
      const context = normalizeText(
        (bounds.root.textContent ?? '').slice(bounds.start, bounds.end),
      );
      if (context && context !== normalizeText(note.text)) contexts[note.id] = context;
    } catch (error) {
      console.warn('Failed to read context for annotation:', error);
    }
  }
  return contexts;
};
