import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { useVocabularyStore } from '@/store/vocabularyStore';
import {
  type AnkiImportPlan,
  ankiNotesToSend,
  ankiTagUpdates,
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
  ankiReadDeck,
  ankiRequestPermission,
  ankiStatus,
  ankiUpdateTags,
} from '@/services/vocabulary/ankiDroid';
import { isAnkiAllowed } from '@/utils/access';
import { eventDispatcher } from '@/utils/event';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';

const DECK_NAME = 'Readest Vocabulary';
/** Anki calls a review card mature from a 21-day interval. */
const MATURE_INTERVAL = 21;

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
  const { appService } = useEnv();
  const { user } = useAuth();
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const [status, setStatus] = useState<{ installed: boolean; granted: boolean } | null>(null);
  const [importState, setImportState] = useState<AnkiImportState | null>(null);
  const [syncing, setSyncing] = useState(false);
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

  /**
   * Read the Readest deck family and apply it to the list: newly mature cards
   * make words Mastered, notes for words Readest doesn't have come in as Learning.
   */
  const pull = async () => {
    const ids = deckFamily(await ankiListDecks(), DECK_NAME);
    const { notes: rows, cards } = ids.length
      ? await ankiReadDeck(ids, true)
      : { notes: [], cards: [] as AnkiCardRow[] };
    const store = useVocabularyStore.getState();
    const lang = defaultImportLang(store.entries);
    const notes = withNoteLangs(rows, store.entries, lang);
    const plan = planAnkiImport(importNotes(notes, cards), store.entries, lang, readMatured());
    store.importWords(plan.ops);
    // Without the cards no card reads as mature, which says nothing about lapses.
    if (cards) saveMatured(plan.matured);
    return { notes, lang, plan, cardsRead: !!cards };
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

  /** Pull, then add Learning words the deck lacks, then bring mark tags in step. */
  const sync = async () => {
    if (!guard()) return;
    setSyncing(true);
    try {
      if (!(await ready())) return;
      const { notes, lang, plan, cardsRead } = await pull();
      const { entries } = useVocabularyStore.getState();
      // Words with no sentence came in from Anki, so they're already there.
      const learning = Object.values(entries).filter(
        (e) => e.state === 'learning' && e.occurrences.length,
      );
      const outgoing = ankiNotesToSend(learning, notes);
      const sent = outgoing.length ? await ankiAddNotes(DECK_NAME, outgoing) : 0;
      const updates = ankiTagUpdates(notes, entries, lang);
      if (updates.length) await ankiUpdateTags(updates);
      const parts = [
        ...(sent ? [_('Added {{count}} words to Anki', { count: sent })] : []),
        ...pullSummary(plan),
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
        deckId: (decks.find((d) => d.name === DECK_NAME) ?? decks[0]!).id,
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
      const store = useVocabularyStore.getState();
      const plan = planAnkiImport(importNotes(notes, cards), store.entries, lang);
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

  return {
    available: !!status?.installed,
    premiumBadge,
    syncing,
    sync,
    openImport,
    importState,
    runImport,
    closeImport: () => setImportState(null),
    guardFileExport: guard,
  };
};
