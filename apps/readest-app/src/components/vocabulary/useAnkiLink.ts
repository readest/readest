import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { getEnabledProviders } from '@/services/dictionaries/registry';
import {
  ANKI_DECK,
  ANKI_NOTE_TYPE,
  type AnkiImportPlan,
  type AnkiNoteType,
  ankiEntryGaps,
  ankiLayouts,
  ankiNoteFills,
  ankiNoteView,
  ankiNotesToSend,
  ankiProfileNoteType,
  ankiProfileOf,
  ankiSyncNotes,
  ankiTagUpdates,
  ankiWordsToSend,
  defaultImportLang,
  importLanguageOptions,
  planAnkiImport,
  withNoteLangs,
} from '@/services/vocabulary/anki';
import {
  type AnkiCardRow,
  type AnkiDeck,
  type AnkiNoteRow,
  AnkiError,
  ankiAddNotes,
  ankiListDecks,
  ankiListNoteTypes,
  ankiNoteType,
  ankiReadDeck,
  ankiRequestPermission,
  ankiSetEntries,
  ankiStatus,
  ankiUpdateTags,
  ankiUpgradeNoteType,
} from '@/services/vocabulary/ankiDroid';
import { lookupEntry } from '@/services/vocabulary/ankiEntry';
import { hintProviders } from '@/services/vocabulary/hintSources';
import type { AnkiProfileSettings, VocabularyEntry } from '@/services/vocabulary/types';
import { isAnkiAllowed } from '@/utils/access';
import { eventDispatcher } from '@/utils/event';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';

/** Anki calls a review card mature from a 21-day interval. */
const MATURE_INTERVAL = 21;

// Dictionary lookups per Sync for card entries (#7728), new cards first: an
// online dictionary takes a moment per word, and the rest come next Sync.
const MAX_ENTRY_LOOKUPS = 30;

// The words whose mature cards this device has applied. A word lowered after
// that stays lowered until its card lapses and matures again.
const MATURED_KEY = 'readest-anki-matured';
const readMatured = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(MATURED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const saveMatured = (ids: string[]) => {
  try {
    localStorage.setItem(MATURED_KEY, JSON.stringify(ids));
  } catch {}
};

// Set when the reader answered Not now to adding audio, so Sync stops asking.
const AUDIO_DECLINED_KEY = 'readest-anki-audio-declined';
const readAudioDeclined = (): boolean => {
  try {
    return localStorage.getItem(AUDIO_DECLINED_KEY) === '1';
  } catch {
    return false;
  }
};
const saveAudioDeclined = (declined: boolean) => {
  try {
    if (declined) localStorage.setItem(AUDIO_DECLINED_KEY, '1');
    else localStorage.removeItem(AUDIO_DECLINED_KEY);
  } catch {}
};

// The last note whose entry Sync looked up (#7728): the next Sync goes on after it.
const ENTRY_AFTER_KEY = 'readest-anki-entry-after';
const readEntryAfter = (): number => {
  try {
    return Number(localStorage.getItem(ENTRY_AFTER_KEY)) || 0;
  } catch {
    return 0;
  }
};
const saveEntryAfter = (id: number) => {
  try {
    localStorage.setItem(ENTRY_AFTER_KEY, String(id));
  } catch {}
};

/** A deck and its subdecks (`Name::Sub`), which Anki reads as one deck. */
const deckFamily = (decks: AnkiDeck[], name: string): number[] =>
  decks.filter((d) => d.name === name || d.name.startsWith(`${name}::`)).map((d) => d.id);

/** Notes as the import planner reads them: mature when any of their cards is. */
const importNotes = (notes: AnkiNoteRow[], cards?: AnkiCardRow[]) => {
  const mature = new Set(
    (cards ?? [])
      .filter((c) => c.cardType === 2 && c.interval >= MATURE_INTERVAL)
      .map((c) => c.noteId),
  );
  return notes.map((n) => ({ fields: n.fields, tags: n.tags, mature: mature.has(n.id) }));
};

export interface AnkiEntryPickerState {
  providers: { id: string; label: string }[];
  selected: string;
}

export interface AnkiProfilesState {
  decks: string[];
  /** The collection's note types, without Readest's own. */
  noteTypes: AnkiNoteType[];
  settings: AnkiProfileSettings;
}

export interface AnkiImportState {
  decks: AnkiDeck[];
  languages: { code: string; label: string }[];
  deckId: number;
  lang: string;
}

/**
 * The Vocabulary window's link to AnkiDroid (#789): Sync with Anki, the pull
 * when the window opens, importing another deck, and the premium gate shared
 * with the Anki file export.
 */
export const useAnkiLink = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService, envConfig } = useEnv();
  const { user } = useAuth();
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const [status, setStatus] = useState<{ installed: boolean; granted: boolean } | null>(null);
  const [importState, setImportState] = useState<AnkiImportState | null>(null);
  const [entryPicker, setEntryPicker] = useState<AnkiEntryPickerState | null>(null);
  const [profilesState, setProfilesState] = useState<AnkiProfilesState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [audioDeclined, setAudioDeclined] = useState(readAudioDeclined);
  // Resolves the open "Add audio" prompt with the reader's answer.
  const [audioPrompt, setAudioPrompt] = useState<((add: boolean) => void) | null>(null);
  const pulledOnOpen = useRef(false);
  const isAndroid = !!appService?.isAndroidApp;

  useEffect(() => {
    if (!isAndroid) return;
    let live = true;
    void ankiStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [isAndroid]);

  const entitled = isAnkiAllowed(userProfilePlan ?? 'free', customizationPurchased);
  // Only badge users who can't use it yet: signed out, or a resolved plan
  // without it. Never an entitled user, or one whose plan is still loading.
  const premiumBadge =
    !entitled && (!user || userProfilePlan !== undefined) ? _('Premium') : undefined;

  // Results use `success`: unlike `info`, it wraps instead of cutting a summary off.
  const toast = (type: 'success' | 'warning' | 'error', message: string) =>
    eventDispatcher.dispatch('toast', { type, message, timeout: 3000 });

  /** True when the reader may go on; otherwise sends them to sign in or to the plans. */
  const guard = (): boolean => {
    if (entitled) return true;
    if (!user) navigateToLogin(router);
    else if (userProfilePlan !== undefined) navigateToProfile(router);
    return false;
  };

  // Read on every tap: access can be revoked, or AnkiDroid removed, at any time.
  const ready = async (): Promise<boolean> => {
    const now = await ankiStatus();
    if (!now.installed) {
      setStatus(now);
      return false;
    }
    if (now.granted || (await ankiRequestPermission())) return true;
    toast('warning', _('Allow Readest to access AnkiDroid in system settings.'));
    return false;
  };

  const fail = (err: unknown) => {
    if (err instanceof AnkiError && err.code === 'not_ready') {
      toast('warning', _('Open AnkiDroid once, then try again.'));
    } else if (err instanceof AnkiError) {
      toast('warning', _('Allow Readest to access AnkiDroid in system settings.'));
    } else {
      console.warn('[anki] AnkiDroid call failed', err);
      toast('error', _('Could not reach AnkiDroid.'));
    }
  };

  /** The card profiles, and the fields of the note types they use (#7849). */
  const profileLayouts = async () => {
    const profiles = useSettingsStore.getState().settings.ankiProfiles;
    const noteTypes = profiles?.profiles.some((p) => p.noteType) ? await ankiListNoteTypes() : [];
    return { profiles, noteTypes, layouts: ankiLayouts(profiles, noteTypes) };
  };

  const readDecks = async (ids: number[]) =>
    ids.length
      ? ankiReadDeck(ids, true)
      : { notes: [] as AnkiNoteRow[], cards: [] as AnkiCardRow[] };

  /**
   * Read the Readest deck family, and Readest's notes in the decks card
   * profiles send to (#7849), and apply them to the list: newly mature cards
   * make words Mastered, notes for words Readest doesn't have come in as Learning.
   */
  const pull = async () => {
    const decks = await ankiListDecks();
    const { profiles, noteTypes, layouts } = await profileLayouts();
    const ownIds = deckFamily(decks, ANKI_DECK);
    const otherIds = new Set(
      profiles?.profiles.flatMap((p) => (p.deck ? deckFamily(decks, p.deck) : [])),
    );
    const own = await readDecks(ownIds);
    const other = await readDecks([...otherIds].filter((id) => !ownIds.includes(id)));
    const { notes: rows, known } = ankiSyncNotes(own.notes, other.notes, layouts);
    const cards = own.cards && other.cards ? [...own.cards, ...other.cards] : undefined;
    const store = useVocabularyStore.getState();
    const lang = defaultImportLang(store.entries);
    const notes = withNoteLangs(
      rows.map((n) => ankiNoteView(n, layouts)),
      store.entries,
      lang,
    );
    const plan = planAnkiImport(importNotes(notes, cards), store.entries, lang, readMatured());
    store.importWords(plan.ops);
    // Without the cards no card reads as mature, which says nothing about lapses.
    if (cards) saveMatured(plan.matured);
    return {
      notes,
      // As read, with the language tags `notes` gave them: entries go by field.
      rows: rows.map((n, i) => ({ ...n, tags: notes[i]!.tags })),
      // Only for matching: the reader's own notes in a profile's deck.
      known: known.map((n) => ankiNoteView(n, layouts)),
      profiles,
      noteTypes,
      lang,
      plan,
      cardsRead: !!cards,
    };
  };

  const pullSummary = (plan: AnkiImportPlan) => [
    ...(plan.added ? [_('Imported {{count}} new words', { count: plan.added })] : []),
    ...(plan.mastered ? [_('{{count}} now Mastered', { count: plan.mastered })] : []),
  ];

  // Pull on open: only reads, never asks for access, and stays quiet unless
  // something changed.
  useEffect(() => {
    if (!status?.granted || !entitled || pulledOnOpen.current) return;
    pulledOnOpen.current = true;
    pull()
      .then(({ plan }) => {
        const parts = pullSummary(plan);
        if (parts.length) toast('success', parts.join(' · '));
      })
      .catch((err) => console.warn('[anki] pull on open failed', err));
  }, [status, entitled]);

  const declineAudio = (declined: boolean) => {
    saveAudioDeclined(declined);
    setAudioDeclined(declined);
  };

  /**
   * A note type from before #7729 gets its audio fields only when the reader
   * agrees, once: adding fields makes AnkiDroid's next AnkiWeb sync a full one.
   * Resolves with the answer, or null when there was nothing to ask.
   */
  const askAudio = async (): Promise<boolean | null> => {
    if (!(await ankiNoteType()).outdated) {
      declineAudio(false);
      return null;
    }
    if (readAudioDeclined()) return null;
    const add = await new Promise<boolean>((resolve) => setAudioPrompt(() => resolve));
    setAudioPrompt(null);
    if (!add) declineAudio(true);
    return add;
  };

  // Opened from the library, the dictionaries and their settings may not be
  // loaded yet: the choice would read as None and a save would overwrite them.
  const loadDictionaries = () =>
    useCustomDictionaryStore
      .getState()
      .loadCustomDictionaries(envConfig)
      .catch(() => false);

  // The dictionaries a card entry can come from: no web searches, no paid AI.
  const entryProviders = () => {
    const { settings, dictionaries } = useCustomDictionaryStore.getState();
    return hintProviders(
      getEnabledProviders({ settings, dictionaries, fs: appService ?? undefined }),
    );
  };

  /** The reader's card dictionary. */
  const entryProvider = () => {
    const id = useCustomDictionaryStore.getState().settings.ankiEntryProviderId;
    return id ? entryProviders().find((p) => p.id === id) : undefined;
  };

  /** Pull, then add Learning words the deck lacks, then bring mark tags in step. */
  const sync = async () => {
    if (!guard()) return;
    setSyncing(true);
    try {
      if (!(await ready())) return;
      const first = await pull();
      const add = await askAudio();
      // The prompt asks the reader to sync AnkiDroid first, which can bring in notes.
      const { notes, rows, known, profiles, noteTypes, lang, plan, cardsRead } =
        add === null ? first : await pull();
      const voiced = add ? await ankiUpgradeNoteType(ankiNoteFills(notes)) : 0;
      const existing = [...notes, ...known];
      // Words with no sentence came in from Anki, so they're already there.
      const learningOf = (all: Record<string, VocabularyEntry>) =>
        Object.values(all).filter((e) => e.state === 'learning' && e.occurrences.length);
      const learning = learningOf(useVocabularyStore.getState().entries);
      // Dictionary entries (#7728): the cards about to be added first, then
      // older cards without one, within the lookup budget.
      const noteType = await ankiNoteType();
      await loadDictionaries();
      const provider = entryProvider();
      // A card has a place for the entry: Readest's Entry (no fields yet: Sync
      // creates the note type, with Entry), or the field its profile maps in a
      // note type it can send with.
      const takesEntry = (e: VocabularyEntry) => {
        const profile = ankiProfileOf(e, profiles);
        if (profile?.noteType) {
          const type = ankiProfileNoteType(profile, noteTypes);
          return !!type?.fields.some((f) => profile.fields[f] === 'entry');
        }
        return !noteType.fields || noteType.fields.includes('Entry');
      };
      const looked: Record<string, string> = {};
      const gapEntries: { id: number; field: number; entry: string }[] = [];
      if (provider) {
        const words = ankiWordsToSend(learning, existing)
          .filter(takesEntry)
          .slice(0, MAX_ENTRY_LOOKUPS);
        for (const e of words) looked[e.id] = await lookupEntry(e.word, e.lang, provider);
        const layouts = ankiLayouts(profiles, noteTypes, noteType);
        const gaps = ankiEntryGaps(rows, layouts, lang, readEntryAfter()).slice(
          0,
          MAX_ENTRY_LOOKUPS - words.length,
        );
        for (const gap of gaps) {
          const entry = await lookupEntry(gap.word, gap.lang, provider);
          if (entry) gapEntries.push({ id: gap.id, field: gap.field, entry });
        }
        if (gaps.length) saveEntryAfter(gaps[gaps.length - 1]!.id);
      }
      // The lookups take a while: send and tag what the list holds now.
      const toSend = learningOf(useVocabularyStore.getState().entries);
      const outgoing = ankiNotesToSend(toSend, existing, looked, profiles, noteTypes);
      // Their profile's note type isn't in this collection, or has no Word field.
      const waiting = ankiWordsToSend(toSend, existing).length - outgoing.length;
      const sent = outgoing.length ? await ankiAddNotes(outgoing) : 0;
      const entered =
        Object.values(looked).filter(Boolean).length +
        (gapEntries.length ? await ankiSetEntries(gapEntries) : 0);
      // Read again: the reader may have changed a mark during the Anki calls.
      const updates = ankiTagUpdates(notes, useVocabularyStore.getState().entries, lang);
      if (updates.length) await ankiUpdateTags(updates);
      const parts = [
        ...(voiced ? [_('Added audio to {{count}} cards', { count: voiced })] : []),
        ...(entered ? [_('Added dictionary entries to {{count}} cards', { count: entered })] : []),
        ...(sent ? [_('Added {{count}} words to Anki', { count: sent })] : []),
        ...(waiting
          ? [
              _(
                "{{count}} words not sent: their profile's note type is missing from AnkiDroid or has no Word field",
                { count: waiting },
              ),
            ]
          : []),
        ...pullSummary(
          plan === first.plan
            ? plan
            : {
                ...plan,
                added: first.plan.added + plan.added,
                mastered: first.plan.mastered + plan.mastered,
              },
        ),
      ];
      if (!cardsRead) parts.push(_('Update AnkiDroid to bring back mastered words.'));
      toast('success', parts.length ? parts.join(' · ') : _('In sync with Anki'));
    } catch (err) {
      fail(err);
    } finally {
      setSyncing(false);
    }
  };

  const openImport = async () => {
    if (!guard()) return;
    try {
      if (!(await ready())) return;
      const decks = await ankiListDecks();
      if (!decks.length) {
        toast('warning', _('No decks in AnkiDroid.'));
        return;
      }
      const { entries } = useVocabularyStore.getState();
      setImportState({
        decks,
        languages: importLanguageOptions(entries),
        deckId: (decks.find((d) => d.name === ANKI_DECK) ?? decks[0]!).id,
        lang: defaultImportLang(entries),
      });
    } catch (err) {
      fail(err);
    }
  };

  const runImport = async (deckId: number, lang: string) => {
    try {
      const decks = importState?.decks ?? [];
      const name = decks.find((d) => d.id === deckId)?.name;
      const { notes, cards } = await ankiReadDeck(name ? deckFamily(decks, name) : [deckId], true);
      // A profile's note type reads its word and hint from the fields it maps.
      const { layouts } = await profileLayouts();
      const store = useVocabularyStore.getState();
      const views = notes.map((n) => ankiNoteView(n, layouts));
      const plan = planAnkiImport(importNotes(views, cards), store.entries, lang);
      store.importWords(plan.ops);
      setImportState(null);
      const parts = [_('Imported {{count}} new words', { count: plan.added })];
      if (plan.mastered) parts.push(_('{{count}} now Mastered', { count: plan.mastered }));
      if (plan.skipped) parts.push(_('{{count}} skipped', { count: plan.skipped }));
      if (!cards) parts.push(_('Update AnkiDroid to bring back mastered words.'));
      toast('success', parts.join(' · '));
    } catch (err) {
      fail(err);
    }
  };

  /** The card profiles panel (#7849), with the collection's decks and note types to pick. */
  const openProfiles = async () => {
    if (!guard()) return;
    try {
      if (!(await ready())) return;
      const [decks, noteTypes] = await Promise.all([ankiListDecks(), ankiListNoteTypes()]);
      setProfilesState({
        decks: decks.map((d) => d.name).sort((a, b) => a.localeCompare(b)),
        noteTypes: noteTypes.filter((t) => t.name !== ANKI_NOTE_TYPE),
        settings: useSettingsStore.getState().settings.ankiProfiles ?? {
          profiles: [],
          languages: {},
          books: {},
        },
      });
    } catch (err) {
      fail(err);
    }
  };

  const saveProfiles = async (ankiProfiles: AnkiProfileSettings) => {
    const { settings, setSettings, saveSettings } = useSettingsStore.getState();
    const next = { ...settings, ankiProfiles };
    try {
      setSettings(next);
      await saveSettings(envConfig, next);
      setProfilesState(null);
    } catch (err) {
      console.warn('[anki] saving the card profiles failed', err);
      // Only the profiles: other settings may have changed during the save.
      setSettings({
        ...useSettingsStore.getState().settings,
        ankiProfiles: settings.ankiProfiles,
      });
      toast('error', _("Couldn't save"));
    }
  };

  const openEntryPicker = async () => {
    if (!guard() || !(await loadDictionaries())) return;
    setEntryPicker({
      providers: entryProviders().map(({ id, label }) => ({ id, label })),
      selected: useCustomDictionaryStore.getState().settings.ankiEntryProviderId ?? '',
    });
  };

  const saveEntryPicker = async (id: string) => {
    const store = useCustomDictionaryStore.getState();
    const previous = store.settings.ankiEntryProviderId;
    store.setAnkiEntryProviderId(id || undefined);
    try {
      await store.saveCustomDictionaries(envConfig);
      setEntryPicker(null);
    } catch (err) {
      console.warn('[anki] saving the card dictionary failed', err);
      // Put the old choice back in both stores, so Sync doesn't use one that wasn't saved.
      store.setAnkiEntryProviderId(previous);
      const { settings, setSettings } = useSettingsStore.getState();
      setSettings({
        ...settings,
        dictionarySettings: useCustomDictionaryStore.getState().settings,
      });
      toast('error', _("Couldn't save"));
    }
  };

  return {
    available: !!status?.installed,
    premiumBadge,
    syncing,
    sync,
    openImport,
    importState,
    runImport,
    closeImport: () => setImportState(null),
    profilesState,
    openProfiles,
    saveProfiles,
    closeProfiles: () => setProfilesState(null),
    entryPicker,
    openEntryPicker,
    saveEntryPicker,
    closeEntryPicker: () => setEntryPicker(null),
    guardFileExport: guard,
    audioPrompt: !!audioPrompt,
    answerAudioPrompt: (add: boolean) => audioPrompt?.(add),
    audioDeclined,
    // Asking again: the next Sync shows the prompt.
    addAudio: () => {
      declineAudio(false);
      void sync();
    },
  };
};
