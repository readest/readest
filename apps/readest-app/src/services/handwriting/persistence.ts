import type { BookConfig } from '@/types/book';
import { HandwritingEditor } from './editor';
import { parseHandwriting } from './model';

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
