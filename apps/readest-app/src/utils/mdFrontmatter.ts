// YAML frontmatter for standalone .md books (see utils/md.ts).
//
// Markdown has no metadata container of its own, so Obsidian, Jekyll, Hugo,
// Pandoc and friends all settled on a leading `---` block of YAML. Issue #5279
// asks for that block to reach the library: a `cover:` image and an `isbn:`
// (which is what unlocks metadata auto-retrieve), plus the usual book details.
//
// Parsing is deliberately hand-rolled rather than pulling in a YAML engine.
// Frontmatter in the wild is a flat map of scalars and short lists, and that is
// exactly what this covers: `key: value`, block lists, flow lists, comments and
// quoting. Block scalars (`|`, `>`), nested maps, anchors and multi-document
// streams are skipped, never thrown on — a frontmatter mistake must cost the
// reader a metadata field, not the whole book.

import type { BookMetadata } from '@/libs/document';

export type FrontmatterFields = Record<string, string | string[]>;

// `author` widens the `BookMetadata` field: a frontmatter list of names stays a
// list, which `formatAuthors` / `getAuthorsList` in utils/book.ts already
// accept, and which keeps the names separable for sorting and search.
export type MarkdownMetadata = Omit<Partial<BookMetadata>, 'author'> & {
  author?: string | string[];
};

const BLOCK_RE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const KEY_RE = /^([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/;
const ITEM_RE = /^[ \t]*-[ \t]*(.+)$/;
const COMMENT_RE = /^[ \t]*#/;
// `|`, `>`, and their chomping / explicit-indent variants: the start of a block
// scalar, whose continuation lines this parser cannot reassemble.
const BLOCK_SCALAR_RE = /^[|>][-+]?\d*$/;

// A scalar as written in the block. A value wrapped in matching quotes is taken
// verbatim (a `#` inside it is content, not a comment); anything else has a
// trailing comment stripped. YAML only starts a comment after whitespace, so
// `https://host/img.jpg#anchor` keeps its fragment.
const unquote = (raw: string): string => {
  const value = raw.trim();
  const quoted = value.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) return quoted[2]!;
  return value.replace(/\s+#.*$/, '').trim();
};

// `[a, b]`. Values containing commas would need a real tokenizer; frontmatter
// lists are tags and author names, so a split is enough.
const parseFlowList = (raw: string): string[] =>
  raw.slice(1, -1).split(',').map(unquote).filter(Boolean);

/**
 * Split a leading `---` frontmatter block off `text`.
 *
 * Keys are normalized to lowercase with `-` and `_` removed, so `ISBN`,
 * `Cover-Image` and `series_index` each collapse onto one lookup key.
 * Returns the text unchanged with no fields when there is no complete block.
 */
export const parseFrontmatter = (text: string): { body: string; fields: FrontmatterFields } => {
  const match = text.match(BLOCK_RE);
  if (!match) return { body: text, fields: {} };

  const fields: FrontmatterFields = {};
  // The key of a `key:` line still waiting to see whether indented `- item`
  // lines follow. The list is only recorded once an item actually arrives, so a
  // key with neither value nor items leaves no empty entry behind.
  let pendingKey: string | null = null;
  let pendingList: string[] | null = null;

  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim() || COMMENT_RE.test(line)) continue;

    const item = pendingKey ? line.match(ITEM_RE) : null;
    if (item) {
      if (!pendingList) {
        pendingList = [];
        fields[pendingKey!] = pendingList;
      }
      const value = unquote(item[1]!);
      if (value) pendingList.push(value);
      continue;
    }

    pendingKey = null;
    pendingList = null;

    const kv = line.match(KEY_RE);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase().replace(/[-_]/g, '');
    const raw = kv[2]!.trim();

    if (!raw) {
      pendingKey = key;
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      fields[key] = parseFlowList(raw);
    } else if (!BLOCK_SCALAR_RE.test(raw)) {
      fields[key] = unquote(raw);
    }
  }

  return { body: text.slice(match[0]!.length), fields };
};

// The first key that carries a non-empty value, in the order given.
const pick = (fields: FrontmatterFields, ...keys: string[]): string | string[] | undefined => {
  for (const key of keys) {
    const value = fields[key];
    if (value === undefined) continue;
    const cleaned = Array.isArray(value)
      ? value.map((v) => v.trim()).filter(Boolean)
      : value.trim();
    if (cleaned.length) return cleaned;
  }
  return undefined;
};

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const many = (value: string | string[] | undefined): string[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

const DATA_URI_RE = /^data:([^,]*),([\s\S]*)$/i;

// Decode a `data:` URI into a Blob. Returns null for anything malformed so a
// broken cover falls back to the generated one instead of failing the import.
const dataUriToBlob = (uri: string): Blob | null => {
  const match = uri.match(DATA_URI_RE);
  if (!match) return null;
  const header = match[1]!;
  const isBase64 = /;base64$/i.test(header);
  // RFC 2397: an omitted media type means text/plain.
  const type =
    (isBase64 ? header.slice(0, -';base64'.length) : header).split(';')[0] || 'text/plain';
  try {
    if (!isBase64) return new Blob([decodeURIComponent(match[2]!)], { type });
    const binary = atob(match[2]!);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
};

/**
 * Map parsed frontmatter fields onto book metadata.
 *
 * Only keys the frontmatter actually supplied are set; the fallbacks that need
 * the document or the filename (title, language, identifier) stay in md.ts.
 *
 * A `data:` cover is decoded to a Blob for the importer to write as the book's
 * cover file. An `http(s)` cover is kept as `coverImageUrl` and not fetched:
 * `BookCover` renders that URL directly, which shows the cover on every
 * platform without a cross-origin request the web build would usually lose.
 * Relative paths are ignored — a standalone .md has no sibling files to read.
 */
export const frontmatterToMetadata = (
  fields: FrontmatterFields,
): { metadata: MarkdownMetadata; coverBlob: Blob | null } => {
  const metadata: MarkdownMetadata = {};
  const set = <K extends keyof MarkdownMetadata>(key: K, value: MarkdownMetadata[K]) => {
    if (value !== undefined) metadata[key] = value;
  };

  set('title', one(pick(fields, 'title')));
  set('subtitle', one(pick(fields, 'subtitle')));
  set('author', pick(fields, 'author', 'authors'));
  set('isbn', one(pick(fields, 'isbn')));
  set('identifier', one(pick(fields, 'identifier')));
  set('language', one(pick(fields, 'language', 'lang')));
  set('publisher', one(pick(fields, 'publisher')));
  set('published', one(pick(fields, 'published', 'date', 'pubdate')));
  set('description', one(pick(fields, 'description', 'summary')));
  set('subject', many(pick(fields, 'subject', 'tags', 'keywords')));
  set('series', one(pick(fields, 'series')));

  const seriesIndex = parseFloat(one(pick(fields, 'seriesindex')) ?? '');
  if (Number.isFinite(seriesIndex)) metadata.seriesIndex = seriesIndex;

  let coverBlob: Blob | null = null;
  const cover = one(pick(fields, 'cover', 'coverimage', 'image'));
  if (cover?.startsWith('data:')) {
    coverBlob = dataUriToBlob(cover);
  } else if (cover && /^https?:\/\//i.test(cover)) {
    metadata.coverImageUrl = cover;
  }

  return { metadata, coverBlob };
};
