// One Markdown note per book in an Obsidian vault, kept in step with the
// book's highlights (#7061).
//
// Each highlight is a quote callout followed by an Obsidian block id line
// (`^rd-<noteId>`), so a highlight is found again by id wherever the user moved
// it, and can be linked to from other notes. A block is rewritten or removed
// only while it still hashes to what this device last wrote (`written`); a
// block the user edited is left alone, and one the user deleted stays deleted.
// Everything outside the blocks belongs to the user and is never touched,
// except the `progress` property.

export interface VaultBook {
  hash: string;
  title: string;
  author: string;
  /** Reading progress in percent. */
  progress: number | null;
  /** File name of the cover image copied into the vault. */
  cover: string | null;
}

export interface VaultHighlight {
  id: string;
  text: string;
  note: string;
  color: string;
  chapter: string | null;
  url: string;
  deleted: boolean;
}

/** Note id → hash of the callout this device last wrote for it. */
export type WrittenBlocks = Record<string, string>;

const HIGHLIGHTS_HEADING = '# Highlights';

const hash = (value: string): string => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

const blockId = (noteId: string) => `rd-${noteId.replace(/[^A-Za-z0-9-]/g, '-')}`;

const quote = (text: string, prefix: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => (line ? `${prefix} ${line}` : prefix));

export const renderHighlight = (highlight: VaultHighlight, bookTitle: string): string => {
  const color = highlight.color.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'yellow';
  const label = (highlight.chapter || bookTitle)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\[\]]/g, '\\$&');
  const url = highlight.url.replace(
    /[()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const lines = [`> [!quote|${color}] [${label}](${url})`, ...quote(highlight.text, '>')];
  if (highlight.note.trim()) lines.push('>', '> > [!note]', ...quote(highlight.note, '> >'));
  return lines.join('\n');
};

export const createVaultNote = (book: VaultBook): string =>
  [
    '---',
    `title: ${JSON.stringify(book.title)}`,
    `author: ${JSON.stringify(book.author)}`,
    ...(book.cover ? [`cover: ${JSON.stringify(`[[${book.cover}]]`)}`] : []),
    ...(book.progress !== null ? [`progress: ${book.progress}`] : []),
    `readest_book_id: ${book.hash}`,
    'tags:',
    '  - readest',
    '---',
    '',
    HIGHLIGHTS_HEADING,
    '',
  ].join('\n');

const splitFrontmatter = (text: string): { frontmatter: string; body: string } => {
  const match = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text);
  return match
    ? { frontmatter: match[0], body: text.slice(match[0].length) }
    : { frontmatter: '', body: text };
};

interface Unit {
  /** First line of the callout. */
  start: number;
  /** The block id line. */
  idLine: number;
  callout: string;
}

const findUnit = (lines: string[], noteId: string): Unit | null => {
  const idText = `^${blockId(noteId)}`;
  const idLine = lines.findIndex((line) => line.trimEnd() === idText);
  if (idLine < 0) return null;
  let end = idLine;
  while (end > 0 && !lines[end - 1]!.trim()) end--;
  let start = end;
  while (start > 0 && lines[start - 1]!.startsWith('>')) start--;
  return { start, idLine, callout: lines.slice(start, end).join('\n') };
};

const unitLines = (callout: string, noteId: string) => [
  ...callout.split('\n'),
  '',
  `^${blockId(noteId)}`,
];

export const mergeVaultNote = (
  existing: string,
  book: VaultBook,
  highlights: VaultHighlight[],
  previous: WrittenBlocks,
): { text: string; written: WrittenBlocks } => {
  const normalized = existing.replace(/\r\n?/g, '\n');
  let { frontmatter, body } = splitFrontmatter(normalized);
  if (book.progress !== null) {
    const progress = `progress: ${book.progress}`;
    frontmatter = /^progress:/m.test(frontmatter)
      ? frontmatter.replace(/^progress:.*$/m, progress)
      : frontmatter.replace(/^readest_book_id:/m, `${progress}\n$&`);
  }
  const lines = body.replace(/\s+$/, '').split('\n');
  const written: WrittenBlocks = { ...previous };
  const untouched = (noteId: string, unit: Unit) => written[noteId] === hash(unit.callout);

  for (const highlight of highlights) {
    if (!highlight.deleted) continue;
    const unit = findUnit(lines, highlight.id);
    if (unit && untouched(highlight.id, unit)) {
      lines.splice(unit.start, unit.idLine - unit.start + 1);
      if (!lines[unit.start - 1]?.trim() && !lines[unit.start]?.trim()) {
        lines.splice(unit.start, 1);
      }
    }
    delete written[highlight.id];
  }

  const active = highlights.filter((highlight) => !highlight.deleted);
  const starts = active.map((h) => findUnit(lines, h.id)?.start ?? Infinity);
  const heading = lines.findIndex((line) => line.trim() === HIGHLIGHTS_HEADING);
  let cursor = Math.min(...starts);
  if (cursor === Infinity) cursor = heading >= 0 ? heading + 1 : lines.length;

  for (const highlight of active) {
    const rendered = renderHighlight(highlight, book.title);
    const unit = findUnit(lines, highlight.id);
    if (unit) {
      if (unit.callout === rendered) {
        written[highlight.id] = hash(rendered);
      } else if (untouched(highlight.id, unit)) {
        const replacement = unitLines(rendered, highlight.id);
        lines.splice(unit.start, unit.idLine - unit.start + 1, ...replacement);
        written[highlight.id] = hash(rendered);
        cursor = unit.start + replacement.length;
        continue;
      }
      cursor = unit.idLine + 1;
      continue;
    }
    // A block this device wrote and can no longer find was deleted by the user.
    if (written[highlight.id]) continue;
    const insert = unitLines(rendered, highlight.id);
    if (cursor > 0 && lines[cursor - 1]!.trim()) insert.unshift('');
    if (cursor < lines.length && lines[cursor]!.trim()) insert.push('');
    lines.splice(cursor, 0, ...insert);
    cursor += insert.length - (insert.at(-1) === '' ? 1 : 0);
    written[highlight.id] = hash(rendered);
  }

  return { text: `${frontmatter}${lines.join('\n').replace(/\s+$/, '')}\n`, written };
};
