import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { useVocabularyStore } from '@/store/vocabularyStore';
import {
  ankiNotesToSend,
  defaultImportLang,
  importLanguageOptions,
  planAnkiImport,
} from '@/services/vocabulary/anki';
import {
  type AnkiDeck,
  AnkiError,
  ankiAddNotes,
  ankiListDecks,
  ankiReadDeck,
  ankiRequestPermission,
  ankiStatus,
} from '@/services/vocabulary/ankiDroid';
import type { VocabularyEntry } from '@/services/vocabulary/types';
import { isAnkiAllowed } from '@/utils/access';
import { eventDispatcher } from '@/utils/event';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';

const DECK_NAME = 'Readest Vocabulary';
/** Anki calls a review card mature from a 21-day interval. */
const MATURE_INTERVAL = 21;

/** A deck and its subdecks (`Name::Sub`), which Anki reads as one deck. */
const deckFamily = (decks: AnkiDeck[], name: string): number[] =>
  decks.filter((d) => d.name === name || d.name.startsWith(`${name}::`)).map((d) => d.id);

export interface AnkiImportState {
  decks: AnkiDeck[];
  languages: { code: string; label: string }[];
  deckId: number;
  lang: string;
}

/**
 * The Vocabulary window's link to AnkiDroid (#789): Send to Anki, Import from
 * Anki, and the premium gate shared with the Anki file export.
 */
export const useAnkiLink = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { user } = useAuth();
  const { userProfilePlan, customizationPurchased } = useQuotaStats();
  const [available, setAvailable] = useState(false);
  const [importState, setImportState] = useState<AnkiImportState | null>(null);
  const isAndroid = !!appService?.isAndroidApp;

  useEffect(() => {
    if (!isAndroid) return;
    let live = true;
    void ankiStatus().then((s) => live && setAvailable(s.installed));
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
    const status = await ankiStatus();
    if (!status.installed) {
      setAvailable(false);
      return false;
    }
    if (status.granted || (await ankiRequestPermission())) return true;
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

  const send = async (entries: VocabularyEntry[]) => {
    if (!guard()) return;
    try {
      if (!(await ready())) return;
      const deckIds = deckFamily(await ankiListDecks(), DECK_NAME);
      const existing = deckIds.length ? (await ankiReadDeck(deckIds, false)).notes : [];
      const { notes, skipped } = ankiNotesToSend(entries, existing);
      const added = notes.length ? await ankiAddNotes(DECK_NAME, notes) : 0;
      const parts = added ? [_('Added {{count}} words to Anki', { count: added })] : [];
      if (skipped) parts.push(_('{{count}} already in Anki', { count: skipped }));
      toast('success', parts.join(' · '));
    } catch (err) {
      fail(err);
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
      const mature = new Set(
        (cards ?? [])
          .filter((c) => c.cardType === 2 && c.interval >= MATURE_INTERVAL)
          .map((c) => c.noteId),
      );
      const store = useVocabularyStore.getState();
      const plan = planAnkiImport(
        notes.map((n) => ({ fields: n.fields, tags: n.tags, mature: mature.has(n.id) })),
        store.entries,
        lang,
      );
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
    available,
    premiumBadge,
    send,
    openImport,
    importState,
    runImport,
    closeImport: () => setImportState(null),
    guardFileExport: guard,
  };
};
