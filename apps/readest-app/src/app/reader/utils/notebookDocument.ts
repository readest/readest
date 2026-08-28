import { BookNote } from '@/types/book';

export const NOTEBOOK_ID = 'notebook';
export const NOTEBOOK_MAX_BYTES = 256 * 1024;

const textEncoder = new TextEncoder();

export interface NotebookMutationResult {
  accepted: boolean;
  bytes: number;
}

export interface NotebookRecordUpdate {
  booknotes: BookNote[];
  notebook: BookNote;
}

export interface NotebookInsertionResult {
  content: string;
  insertedStart: number;
  insertedEnd: number;
}

export const getNotebookByteLength = (content: string): number =>
  textEncoder.encode(content).length;

export const validateNotebookMutation = (
  currentContent: string,
  nextContent: string,
): NotebookMutationResult => {
  const currentBytes = getNotebookByteLength(currentContent);
  const bytes = getNotebookByteLength(nextContent);
  const accepted =
    bytes <= NOTEBOOK_MAX_BYTES || (currentBytes > NOTEBOOK_MAX_BYTES && bytes < currentBytes);
  return { accepted, bytes };
};

export const findNotebookRecord = (booknotes: BookNote[]): BookNote | null =>
  booknotes.find(
    (booknote) =>
      booknote.id === NOTEBOOK_ID && booknote.type === 'notebook' && !booknote.deletedAt,
  ) ?? null;

export const upsertNotebookRecord = (
  booknotes: BookNote[],
  content: string,
  compatibilityCfi: string | null,
  now: number,
  createIfMissing: boolean,
): NotebookRecordUpdate | null => {
  const existing = booknotes.find(
    (booknote) => booknote.id === NOTEBOOK_ID && booknote.type === 'notebook',
  );
  if (!existing && !createIfMissing) return null;

  const cfi = existing?.cfi || compatibilityCfi;
  if (!cfi) return null;

  const notebook: BookNote = existing
    ? {
        ...existing,
        cfi,
        note: content,
        updatedAt: now,
        ...(existing.deletedAt != null && { deletedAt: null }),
      }
    : {
        id: NOTEBOOK_ID,
        type: 'notebook',
        cfi,
        note: content,
        createdAt: now,
        updatedAt: now,
      };

  return {
    notebook,
    booknotes: [
      ...booknotes.filter(
        (booknote) => !(booknote.id === NOTEBOOK_ID && booknote.type === 'notebook'),
      ),
      notebook,
    ],
  };
};

const getLineEnding = (content: string): '\n' | '\r\n' =>
  content.includes('\r\n') ? '\r\n' : '\n';

const trimOuterBlankLines = (snippet: string): string => {
  const lineEnding = snippet.includes('\r\n') ? '\r\n' : '\n';
  const lines = snippet.split(/\r\n|\n/);
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
  while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
  return lines.join(lineEnding);
};

const separatorBefore = (prefix: string, lineEnding: string): string => {
  if (!prefix) return '';
  if (prefix.endsWith(`${lineEnding}${lineEnding}`)) return '';
  if (prefix.endsWith(lineEnding)) return lineEnding;
  return `${lineEnding}${lineEnding}`;
};

const separatorAfter = (suffix: string, lineEnding: string): string => {
  if (!suffix) return '';
  if (suffix.startsWith(`${lineEnding}${lineEnding}`)) return '';
  if (suffix.startsWith(lineEnding)) return lineEnding;
  return `${lineEnding}${lineEnding}`;
};

export const insertNotebookMarkdown = (
  content: string,
  snippet: string,
  selectionStart: number,
  selectionEnd: number,
): NotebookInsertionResult => {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, content.length));
  const end = Math.max(start, Math.min(Math.max(selectionStart, selectionEnd), content.length));
  const insertion = trimOuterBlankLines(snippet);
  if (!insertion) {
    return { content, insertedStart: start, insertedEnd: start };
  }

  const prefix = content.slice(0, start);
  const suffix = content.slice(end);
  const lineEnding = getLineEnding(content);
  const before = separatorBefore(prefix, lineEnding);
  const after = separatorAfter(suffix, lineEnding);
  const insertedStart = prefix.length + before.length;

  return {
    content: `${prefix}${before}${insertion}${after}${suffix}`,
    insertedStart,
    insertedEnd: insertedStart + insertion.length,
  };
};
