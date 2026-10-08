import { EnvConfigType } from '@/services/environment';
import { CharacterTag } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { useSettingsStore } from '@/store/settingsStore';

/** App-wide tags (e.g. "villain", "protagonist"), shared across every book. */
export const getCharacterTags = (): CharacterTag[] =>
  useSettingsStore.getState().settings.characterTags ?? [];

export async function upsertCharacterTag(
  envConfig: EnvConfigType,
  tag: { id?: string; name: string; color?: string },
): Promise<CharacterTag> {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const all = settings.characterTags ?? [];
  const next: CharacterTag = { id: tag.id ?? uniqueId(), name: tag.name, color: tag.color };
  const exists = all.some((t) => t.id === next.id);
  const characterTags = exists ? all.map((t) => (t.id === next.id ? next : t)) : [...all, next];
  const updated = { ...settings, characterTags };
  setSettings(updated);
  await saveSettings(envConfig, updated);
  return next;
}

export async function deleteCharacterTag(envConfig: EnvConfigType, tagId: string): Promise<void> {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const updated = {
    ...settings,
    characterTags: (settings.characterTags ?? []).filter((t) => t.id !== tagId),
  };
  setSettings(updated);
  await saveSettings(envConfig, updated);
}
