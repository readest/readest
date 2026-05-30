/**
 * Moon+ Reader (.mrexpt) export file parser.
 *
 * The .mrexpt format is a plaintext file produced by the Android app
 * "Moon+ Reader". Each entry encodes a highlight or annotation captured by
 * the user while reading. The same logic was originally implemented in
 * Python (see MultilingualWord/extract_words_from_epub.py) and is ported
 * here so Readest can import the entries as BookNotes.
 *
 * File layout:
 *   line 0: numeric file header
 *   line 1: "indent:true|false"
 *   line 2: "trim:true|false"
 *   then a sequence of entries separated by a single line containing "#":
 *     line  0: entry id
 *     line  1: book title
 *     line  2: original-case file path
 *     line  3: lowercase file path
 *     line  4: b4 — NCX navPoint 0-based index (chapter locator)
 *     line  5: b5 — paragraph offset high bits (usually 0)
 *     line  6: b6 — character offset within the document
 *     line  7: word character length
 *     line  8: color/marker value (-28160 = pure highlight, others = note color)
 *     line  9: timestamp (ms)
 *     line 10: empty
 *     line 11: empty (pure highlight) or note text (with note)
 *     line 12: the highlighted word/phrase
 *     line 13: type marker — "1" pure highlight, "0" with note
 *     line 14-15: padding zeroes
 */

export interface MrexptEntry {
  /** Highlighted text. */
  word: string;
  /** Optional user note attached to the highlight. */
  note: string;
  /** NCX navPoint 0-based index (chapter locator). */
  b4: number;
  /** Paragraph offset high bits, usually 0. */
  b5: number;
  /** Character offset inside the document. */
  b6: number;
  /** Word character length as recorded by Moon+ Reader. */
  wordLength: number;
  /** Creation timestamp (ms). */
  timestamp: number;
  /** Book title as embedded in the entry. */
  bookTitle: string;
  /** File path as embedded in the entry. */
  bookPath: string;
  /** Original entry id from the file. */
  entryId: string;
  /** Whether the entry has an attached note (type marker "0"). */
  hasNote: boolean;
}

const safeParseInt = (value: string | undefined): number => {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  // allow leading minus
  const numeric = trimmed.replace(/^-/, '');
  if (!/^\d+$/.test(numeric)) return 0;
  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isNumericLine = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^-?\d+$/.test(trimmed);
};

/** Parse the raw text content of a .mrexpt file into a list of entries. */
export const parseMrexpt = (content: string): MrexptEntry[] => {
  // Normalize line endings, then split on a line containing exactly "#".
  // We deliberately use "\n#\n" to mirror the Python implementation.
  const normalized = content.replace(/\r\n?/g, '\n');
  const rawEntries = normalized.split('\n#\n');

  const entries: MrexptEntry[] = [];

  for (let i = 0; i < rawEntries.length; i++) {
    let lines = rawEntries[i]!.split('\n');

    if (i === 0) {
      // First block contains the 3-line file header before the first entry.
      if (lines.length >= 3 && lines[1]!.startsWith('indent:')) {
        lines = lines.slice(3);
      } else {
        continue;
      }
    }

    if (lines.length < 13) continue;

    const entryId = (lines[0] ?? '').trim();
    const bookTitle = (lines[1] ?? '').trim();
    const bookPath = (lines[2] ?? '').trim();
    const b4 = safeParseInt(lines[4]);
    const b5 = safeParseInt(lines[5]);
    const b6 = safeParseInt(lines[6]);
    const wordLength = safeParseInt(lines[7]);
    const timestamp = safeParseInt(lines[9]);

    let word = '';
    let note = '';
    let hasNote = false;

    if (lines.length >= 14) {
      const typeMarker = (lines[13] ?? '').trim();
      if (typeMarker === '0') {
        // Annotation: note in line 11, word in line 12.
        note = (lines[11] ?? '').trim();
        word = (lines[12] ?? '').trim();
        hasNote = true;
      } else if (typeMarker === '1') {
        // Pure highlight: line 11 empty, word in line 12.
        word = (lines[12] ?? '').trim();
      } else {
        // Unknown marker — fall back to the first non-numeric line after 10.
        for (let idx = 10; idx < Math.min(lines.length, 15); idx++) {
          const candidate = (lines[idx] ?? '').trim();
          if (candidate && !isNumericLine(candidate)) {
            word = candidate;
            break;
          }
        }
      }
    } else {
      // Older entries: try line 12 then a non-numeric scan.
      word = (lines[12] ?? '').trim();
      if (!word) {
        for (let idx = 10; idx < lines.length; idx++) {
          const candidate = (lines[idx] ?? '').trim();
          if (candidate && !isNumericLine(candidate)) {
            word = candidate;
            break;
          }
        }
      }
    }

    if (!word) continue;

    entries.push({
      word,
      note,
      b4,
      b5,
      b6,
      wordLength,
      timestamp,
      bookTitle,
      bookPath,
      entryId,
      hasNote,
    });
  }

  return entries;
};
