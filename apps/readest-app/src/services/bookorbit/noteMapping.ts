import { md5 } from 'js-md5';
import type { BookNote, BookNoteType, HighlightStyle, ReadingStatus } from '@/types/book';
import type { KoAnnotation, KoDrawer } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * KOReader datetimes carry no timezone; Readest always uses the UTC frame (and
 * reports deviceTime in UTC too) so every Readest device derives identical
 * identity keys for the same note.
 */
export const formatKoDatetime = (ms: number): string => {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
};

export const formatKoDate = (ms: number): string => formatKoDatetime(ms).slice(0, 10);

export const parseKoDatetime = (dt: string): number => Date.parse(`${dt.replace(' ', 'T')}Z`);

export const bookOrbitKey = (datetime: string, pos: string): string => md5(`${datetime}|${pos}`);

/** Matches readest.koplugin generateNoteId so notes dedupe across sync paths. */
export const bookOrbitNoteId = (
  bookHash: string,
  type: BookNoteType,
  pos0: string,
  pos1?: string,
): string => md5(`ko:${bookHash}:${type}:${pos0}:${pos1 ?? ''}`).slice(0, 7);

// Mirrors KO_TO_READEST_COLOR / READEST_TO_KO_COLOR in readest_syncannotations.lua
const KO_TO_READEST_COLOR: Record<string, string> = {
  yellow: 'yellow',
  red: 'red',
  green: 'green',
  blue: 'blue',
  purple: 'violet',
  orange: '#ff8800',
  cyan: '#00bcd4',
  olive: '#808000',
  gray: '#9e9e9e',
};

const READEST_TO_KO_COLOR: Record<string, string> = Object.fromEntries(
  Object.entries(KO_TO_READEST_COLOR).map(([ko, readest]) => [readest, ko]),
);

export const koColorForNote = (color?: string): string | undefined =>
  color ? READEST_TO_KO_COLOR[color] : undefined;

export const colorForKoColor = (koColor?: string): string | undefined =>
  koColor ? KO_TO_READEST_COLOR[koColor] : undefined;

export const drawerForNote = (note: BookNote): KoDrawer => {
  if (note.style === 'underline') return 'underscore';
  if (note.style === 'squiggly') return 'strikeout';
  return 'lighten';
};

export const styleForDrawer = (drawer: string): HighlightStyle => {
  if (drawer === 'underscore') return 'underline';
  if (drawer === 'strikeout') return 'squiggly';
  return 'highlight';
};

export const noteToKoAnnotation = (
  note: BookNote,
  identityDatetime: string,
): KoAnnotation | null => {
  if (!note.xpointer0) return null;
  const ann: KoAnnotation = {
    datetime: identityDatetime,
    drawer: drawerForNote(note),
    posFormat: 'xpointer',
    pos0: note.xpointer0,
  };
  if (note.xpointer1) ann.pos1 = note.xpointer1;
  if (note.updatedAt > note.createdAt) ann.datetimeUpdated = formatKoDatetime(note.updatedAt);
  const color = koColorForNote(note.color);
  if (color) ann.color = color;
  if (note.text) ann.text = note.text;
  if (note.note) ann.note = note.note;
  return ann;
};

export const readingStatusToBookOrbit = (
  status?: ReadingStatus,
): 'reading' | 'complete' | 'abandoned' | undefined => {
  if (status === 'reading') return 'reading';
  if (status === 'finished') return 'complete';
  if (status === 'abandoned') return 'abandoned';
  return undefined;
};
