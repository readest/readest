import { EnvConfigType } from '@/services/environment';
import { BookCharacter } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';

/** Live (not soft-deleted) characters registered for a book. */
export const getBookCharacters = (bookKey: string): BookCharacter[] =>
  (useBookDataStore.getState().getConfig(bookKey)?.characters ?? []).filter((c) => !c.deletedAt);

/** A blank sheet: an empty image slot and an empty description paragraph. */
export const createCharacter = (name: string): BookCharacter => {
  const now = Date.now();
  return {
    id: uniqueId(),
    name,
    blocks: [
      { id: uniqueId(), type: 'image', src: '' },
      { id: uniqueId(), type: 'text', text: '' },
    ],
    createdAt: now,
    updatedAt: now,
  };
};

async function persist(envConfig: EnvConfigType, bookKey: string, characters: BookCharacter[]) {
  const { setConfig, getConfig, saveConfig } = useBookDataStore.getState();
  setConfig(bookKey, { characters });
  const config = getConfig(bookKey);
  if (!config) return;
  await saveConfig(envConfig, bookKey, config, useSettingsStore.getState().settings);
}

export async function upsertCharacter(
  envConfig: EnvConfigType,
  bookKey: string,
  character: BookCharacter,
): Promise<void> {
  const all = useBookDataStore.getState().getConfig(bookKey)?.characters ?? [];
  const next = { ...character, updatedAt: Date.now(), deletedAt: null };
  const exists = all.some((c) => c.id === character.id);
  await persist(
    envConfig,
    bookKey,
    exists ? all.map((c) => (c.id === character.id ? next : c)) : [...all, next],
  );
}

/** Appends a quote block (selected text) to a character's sheet and saves it. */
export async function addQuoteToCharacter(
  envConfig: EnvConfigType,
  bookKey: string,
  characterId: string,
  quoteText: string,
  sourceCfi?: string,
): Promise<void> {
  const all = useBookDataStore.getState().getConfig(bookKey)?.characters ?? [];
  const target = all.find((c) => c.id === characterId);
  if (!target) return;
  const next: BookCharacter = {
    ...target,
    blocks: [...target.blocks, { id: uniqueId(), type: 'quote', text: quoteText, sourceCfi }],
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await persist(
    envConfig,
    bookKey,
    all.map((c) => (c.id === characterId ? next : c)),
  );
}

export async function deleteCharacter(
  envConfig: EnvConfigType,
  bookKey: string,
  characterId: string,
): Promise<void> {
  const all = useBookDataStore.getState().getConfig(bookKey)?.characters ?? [];
  const now = Date.now();
  await persist(
    envConfig,
    bookKey,
    all.map((c) => (c.id === characterId ? { ...c, deletedAt: now, updatedAt: now } : c)),
  );
}
