// AnkiDroid's content provider, reached through the native bridge (Android
// only). See docs/superpowers/specs/2026-11-04-anki-link-design.md
import { invoke } from '@tauri-apps/api/core';
import type { AnkiNoteFill, AnkiNoteType, AnkiOutgoingNote, AnkiTagUpdate } from './anki';

/** `permission`: Readest can't use AnkiDroid. `not_ready`: AnkiDroid was never opened. */
export type AnkiErrorCode = 'permission' | 'not_ready';

export class AnkiError extends Error {
  constructor(public code: AnkiErrorCode) {
    super(`AnkiDroid: ${code}`);
  }
}

export interface AnkiDeck {
  id: number;
  name: string;
}

export interface AnkiNoteRow {
  id: number;
  /** The note's note type. */
  mid: number;
  fields: string[];
  tags: string;
}

export interface AnkiCardRow {
  noteId: number;
  cardType: number;
  interval: number;
}

// Commands that take arguments read them from `payload` (see commands.rs).
const call = async <T extends { error?: string }>(
  cmd: string,
  payload?: Record<string, unknown>,
): Promise<T> => {
  const res = await invoke<T>(`plugin:native-bridge|${cmd}`, payload ? { payload } : undefined);
  if (res.error) throw new AnkiError(res.error as AnkiErrorCode);
  return res;
};

export const ankiStatus = async (): Promise<{ installed: boolean; granted: boolean }> => {
  try {
    return await invoke<{ installed: boolean; granted: boolean }>(
      'plugin:native-bridge|anki_status',
    );
  } catch {
    return { installed: false, granted: false };
  }
};

export const ankiRequestPermission = async (): Promise<boolean> =>
  (await invoke<{ granted: boolean }>('plugin:native-bridge|anki_request_permission')).granted;

export const ankiListDecks = async (): Promise<AnkiDeck[]> =>
  (await call<{ decks?: AnkiDeck[]; error?: string }>('anki_list_decks')).decks ?? [];

/** Every note type in the collection, with its field names (#7849). */
export const ankiListNoteTypes = async (): Promise<AnkiNoteType[]> =>
  (await call<{ noteTypes?: AnkiNoteType[]; error?: string }>('anki_list_note_types')).noteTypes ??
  [];

/**
 * The notes in these decks and, unless AnkiDroid is older than 2.24, their
 * mature cards (only those are returned).
 */
export const ankiReadDeck = async (
  deckIds: number[],
  withCards: boolean,
): Promise<{ notes: AnkiNoteRow[]; cards?: AnkiCardRow[] }> => {
  const res = await call<{ notes?: AnkiNoteRow[]; cards?: AnkiCardRow[]; error?: string }>(
    'anki_read_deck',
    { deckIds, withCards },
  );
  return { notes: res.notes ?? [], cards: res.cards };
};

/**
 * Add notes to their decks (created if missing), one call per deck and note
 * type; resolves with how many were added.
 */
export const ankiAddNotes = async (notes: AnkiOutgoingNote[]): Promise<number> => {
  const groups = new Map<
    string,
    { deckName: string; modelId?: number; notes: Pick<AnkiOutgoingNote, 'fields' | 'tags'>[] }
  >();
  for (const { deck, modelId, fields, tags } of notes) {
    const key = JSON.stringify([deck, modelId]);
    const group = groups.get(key) ?? { deckName: deck, modelId, notes: [] };
    group.notes.push({ fields, tags });
    groups.set(key, group);
  }
  let added = 0;
  for (const group of groups.values()) {
    added += (await call<{ added?: number; error?: string }>('anki_add_notes', group)).added ?? 0;
  }
  return added;
};

/** Replace the tags of existing notes; resolves with how many were updated. */
export const ankiUpdateTags = async (notes: AnkiTagUpdate[]): Promise<number> =>
  (await call<{ updated?: number; error?: string }>('anki_update_tags', { notes })).updated ?? 0;

/**
 * The Readest note type: whether it is behind its current fields or template
 * (#7729), and its id and field names, which are absent before Sync created it.
 */
export const ankiNoteType = async (): Promise<{
  outdated: boolean;
  id?: number;
  fields?: string[];
}> => {
  const { outdated, id, fields } = await call<{
    outdated?: boolean;
    id?: number;
    fields?: string[];
    error?: string;
  }>('anki_note_type');
  return { outdated: !!outdated, id, fields };
};

/**
 * Put dictionary entries (#7728) into notes' empty entry field, at `field`;
 * resolves with how many were set.
 */
export const ankiSetEntries = async (
  notes: { id: number; field: number; entry: string }[],
): Promise<number> =>
  (await call<{ updated?: number; error?: string }>('anki_set_entries', { notes })).updated ?? 0;

/**
 * Give the note type its audio fields and template, filling them on the notes
 * Sync added before; resolves with how many notes were filled. Adding fields
 * makes AnkiDroid's next AnkiWeb sync a full one.
 */
export const ankiUpgradeNoteType = async (notes: AnkiNoteFill[]): Promise<number> =>
  (await call<{ updated?: number; error?: string }>('anki_upgrade_note_type', { notes })).updated ??
  0;
