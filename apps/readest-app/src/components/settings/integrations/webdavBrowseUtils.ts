import {
  BsBook,
  BsFiletypeJpg,
  BsFiletypeJson,
  BsFiletypeMd,
  BsFiletypeOtf,
  BsFiletypePdf,
  BsFiletypePng,
  BsFiletypeTtf,
  BsFiletypeTxt,
  BsFiletypeWoff,
  BsFiletypeXml,
} from 'react-icons/bs';
import { LuBookImage } from 'react-icons/lu';
import { MdInsertDriveFile } from 'react-icons/md';
import React from 'react';
import { SUPPORTED_BOOK_EXTS } from '@/services/constants';

/**
 * Pure presentational helpers for WebDAVBrowsePane. Lives apart from the
 * component itself so the pane file stays focused on React state and
 * JSX, and these utilities can be unit-tested in isolation if needed.
 */

const BOOK_EXT_SET = new Set<string>(SUPPORTED_BOOK_EXTS.map((e) => e.toLowerCase()));

/**
 * True when the filename's extension matches a reader-supported book
 * format. We deliberately reuse `services/constants.SUPPORTED_BOOK_EXTS`
 * — the same list that gates drag-drop and folder-import — so the
 * download button in the browser only lights up for files the rest
 * of readest can actually open after they land on disk. Keeping the
 * three entry paths (drag-drop, folder import, WebDAV download) on
 * one source of truth avoids the situation where a user can pull a
 * file from the server but then can't ingest it.
 */
export const isSupportedBookExt = (filename: string): boolean => {
  const m = filename.match(/\.([^.]+)$/);
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  return !!ext && BOOK_EXT_SET.has(ext);
};

/** Format a byte count as "{value} {unit}" (B / KB / MB / GB / TB). */
export const formatSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted =
    unit === 0 ? value.toFixed(0) : value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return `${formatted} ${units[unit]}`;
};

/**
 * Render the WebDAV-supplied last-modified timestamp in a compact,
 * locale-aware form. Servers usually emit RFC 1123 via
 * `getlastmodified`; ISO-8601 also parses. Unknown values render as
 * empty so the row simply omits the field rather than showing
 * "Invalid Date".
 */
export const formatLastModified = (raw: string): string => {
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return '';
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    // Some embedded WebViews (older Android) reject options bags
    // that combine date and time fields — fall back to the default
    // formatter rather than showing nothing.
    return new Date(ts).toLocaleString();
  }
};

/**
 * Compact representation of a content hash for the metadata line.
 * Keeps the leading 10 chars (entropy is uniform, so collisions
 * require ~2^20 books) and ellipsizes the rest; the row's title
 * attribute exposes the full hash on hover.
 */
export const formatShortHash = (hash: string): string => {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 10)}…`;
};

/**
 * Pick a per-file icon based on the entry's extension. Reader-
 * recognised formats get a specific icon; everything else stays on
 * the neutral document glyph. Aligned with `EXTS` in `libs/document.ts`.
 */
export const getEntryIcon = (filename: string): React.ComponentType<{ className?: string }> => {
  const m = filename.match(/\.([^.]+)$/);
  const ext = m && m[1] ? m[1].toLowerCase() : '';
  switch (ext) {
    case 'pdf':
      return BsFiletypePdf;
    case 'txt':
      return BsFiletypeTxt;
    case 'md':
      return BsFiletypeMd;
    case 'fb2':
    case 'fbz':
      return BsFiletypeXml;
    case 'cbz':
      return LuBookImage;
    case 'epub':
    case 'mobi':
    case 'azw':
    case 'azw3':
      return BsBook;
    case 'png':
      return BsFiletypePng;
    case 'jpg':
    case 'jpeg':
      return BsFiletypeJpg;
    case 'json':
      return BsFiletypeJson;
    case 'xml':
      return BsFiletypeXml;
    case 'otf':
      return BsFiletypeOtf;
    case 'ttf':
      return BsFiletypeTtf;
    case 'woff':
    case 'woff2':
      return BsFiletypeWoff;
    default:
      return MdInsertDriveFile;
  }
};
