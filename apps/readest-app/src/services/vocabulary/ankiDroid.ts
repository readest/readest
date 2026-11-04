// AnkiDroid's content provider, reached through the native bridge (Android
// only). See docs/superpowers/specs/2026-11-04-anki-link-design.md
import { invoke } from '@tauri-apps/api/core';
import type { AnkiOutgoingNote } from './anki';

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

/** A deck's notes and, unless AnkiDroid is older than 2.24, their cards. */
export const ankiReadDeck = async (
  deckId: number,
  withCards: boolean,
): Promise<{ notes: AnkiNoteRow[]; cards?: AnkiCardRow[] }> => {
  const res = await call<{ notes?: AnkiNoteRow[]; cards?: AnkiCardRow[]; error?: string }>(
    'anki_read_deck',
    { deckId, withCards },
  );
  return { notes: res.notes ?? [], cards: res.cards };
};

/** Add notes to a deck (created if missing); resolves with how many were added. */
export const ankiAddNotes = async (deckName: string, notes: AnkiOutgoingNote[]): Promise<number> =>
  (await call<{ added?: number; error?: string }>('anki_add_notes', { deckName, notes })).added ??
  0;
