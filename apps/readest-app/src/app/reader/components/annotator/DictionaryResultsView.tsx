'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdArrowBack, MdChevronRight, MdSettings } from 'react-icons/md';
import clsx from 'clsx';
import { openUrl } from '@tauri-apps/plugin-opener';

import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { getEnabledProviders } from '@/services/dictionaries/registry';
import { isTauriAppPlatform } from '@/services/environment';
import {
  getBuiltinWebSearch,
  substituteUrlTemplate,
} from '@/services/dictionaries/webSearchTemplates';
import type {
  DictionaryLookupOutcome,
  DictionaryProvider,
  WebSearchEntry,
} from '@/services/dictionaries/types';

const isTauri = isTauriAppPlatform();

interface CardState {
  state: 'loading' | 'loaded' | 'empty' | 'unsupported' | 'error';
  loadKey: string;
  outcome?: DictionaryLookupOutcome;
  expanded: boolean;
}

export interface UseDictionaryResultsArgs {
  word: string;
  lang?: string;
}

export interface DictionaryResultsState {
  currentWord: string;
  canGoBack: boolean;
  goBack: () => void;
  visibleDefinitionProviders: DictionaryProvider[];
  webSearchProviders: DictionaryProvider[];
  cards: Record<string, CardState>;
  setContainerRef: (id: string) => (el: HTMLDivElement | null) => void;
  handleContainerClick: (e: React.MouseEvent) => void;
  toggleExpanded: (id: string) => void;
  resolveWebSearchUrl: (id: string) => string | undefined;
  onWebSearchClickTauri: (e: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
  noProvidersAtAll: boolean;
}

/**
 * State + lookup orchestration shared by the desktop popup and the mobile
 * bottom sheet. Owns:
 *   - the in-component history stack (for in-content link navigation),
 *   - the per-provider lookup fan-out + abort wiring,
 *   - per-card expand/collapse with the ≤ 3-results auto-expand default,
 *   - external-link delegation (Tauri vs web target="_blank"),
 *   - web-search URL resolution.
 *
 * Both wrappers mount this hook and feed its return value into
 * {@link DictionaryResultsHeader} (sticky title + back + manage gear) and
 * {@link DictionaryResultsBody} (card stack + web-search rows).
 */
export function useDictionaryResults({
  word,
  lang,
}: UseDictionaryResultsArgs): DictionaryResultsState {
  const { appService } = useEnv();
  const { dictionaries, settings } = useCustomDictionaryStore();
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

  const computedProviders = getEnabledProviders({
    settings,
    dictionaries,
    fs: appService ?? undefined,
  });
  const providersSignature = computedProviders.map((p) => p.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const providers = useMemo<DictionaryProvider[]>(() => computedProviders, [providersSignature]);

  const definitionProviders = useMemo(() => providers.filter((p) => p.kind !== 'web'), [providers]);
  const webSearchProviders = useMemo(() => providers.filter((p) => p.kind === 'web'), [providers]);

  const [historyStack, setHistoryStack] = useState<string[]>([word]);
  const currentWord = historyStack[historyStack.length - 1] ?? word;

  // Reset the history when the host reopens with a new word from outside
  // (selection change in the reader).
  useEffect(() => {
    setHistoryStack([word]);
  }, [word]);

  const [cards, setCards] = useState<Record<string, CardState>>({});
  // Cards the user has manually toggled. The auto-expand reconciliation
  // (≤ 3 results → default expanded) only writes to cards NOT in this set.
  const [manuallyToggled, setManuallyToggled] = useState<Record<string, boolean>>({});

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setContainerRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) containerRefs.current.set(id, el);
      else containerRefs.current.delete(id);
    },
    [],
  );

  const pushWord = useCallback((next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setHistoryStack((prev) => {
      if (prev[prev.length - 1] === trimmed) return prev;
      return [...prev, trimmed];
    });
  }, []);

  const goBack = useCallback(() => {
    setHistoryStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setCards((prev) => {
      const old = prev[id];
      if (!old) return prev;
      return { ...prev, [id]: { ...old, expanded: !old.expanded } };
    });
    setManuallyToggled((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  // Reset manual-toggle tracking when the looked-up word changes — the
  // auto-expand decision should re-evaluate against the new result count.
  useEffect(() => {
    setManuallyToggled({});
  }, [currentWord]);

  // Auto-expand decision: when ≤ 3 providers have settled with results,
  // default-expand all of them. With > 3, default-collapse. User toggles
  // are sticky (tracked in `manuallyToggled`).
  useEffect(() => {
    const loadedIds = Object.entries(cards)
      .filter(([, c]) => c.state === 'loaded')
      .map(([id]) => id);
    if (loadedIds.length === 0) return;
    const shouldExpand = loadedIds.length <= 3;
    setCards((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of loadedIds) {
        if (manuallyToggled[id]) continue;
        const c = prev[id];
        if (!c) continue;
        if (c.expanded !== shouldExpand) {
          next[id] = { ...c, expanded: shouldExpand };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cards, manuallyToggled]);

  // External-link delegation inside provider-rendered DOM: on Tauri we
  // route http(s) anchors through `openUrl` because target="_blank" doesn't
  // work; on web we let the anchor handle it natively.
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (!isTauri) return;
    if (e.defaultPrevented) return;
    const anchor = (e.target as Element | null)?.closest?.('a');
    if (!anchor) return;
    const rawHref = anchor.getAttribute('href');
    if (!rawHref || !/^https?:\/\//i.test(rawHref)) return;
    e.preventDefault();
    void openUrl(rawHref).catch((err) => {
      console.warn('Failed to open external URL', rawHref, err);
    });
  }, []);

  // Lookup orchestration: fan out across all definition providers in
  // parallel whenever currentWord (or the provider list) changes.
  useEffect(() => {
    if (!definitionProviders.length) return;
    const langCode = typeof lang === 'string' ? lang : Array.isArray(lang) ? lang[0] : undefined;
    const loadKey = `${currentWord}::${langCode || ''}`;

    setCards(() => {
      const next: Record<string, CardState> = {};
      for (const provider of definitionProviders) {
        next[provider.id] = {
          state: 'loading',
          loadKey,
          outcome: undefined,
          expanded: false,
        };
      }
      return next;
    });

    const controllers = new Map<string, AbortController>();
    definitionProviders.forEach((provider) => {
      const controller = new AbortController();
      controllers.set(provider.id, controller);

      const run = async () => {
        let outcome: DictionaryLookupOutcome;
        try {
          if (provider.init) await provider.init();
          const container = containerRefs.current.get(provider.id);
          if (!container) {
            outcome = { ok: false, reason: 'error', message: 'no container' };
          } else {
            container.replaceChildren();
            outcome = await provider.lookup(currentWord, {
              lang: langCode,
              signal: controller.signal,
              container,
              onNavigate: pushWord,
              isDarkMode,
            });
          }
        } catch (err) {
          outcome = {
            ok: false,
            reason: 'error',
            message: err instanceof Error ? err.message : String(err),
          };
        }
        if (controller.signal.aborted) return;
        const state = outcome.ok
          ? 'loaded'
          : outcome.reason === 'empty'
            ? 'empty'
            : outcome.reason === 'unsupported'
              ? 'unsupported'
              : 'error';
        setCards((prev) => {
          const old = prev[provider.id];
          if (!old || old.loadKey !== loadKey) return prev;
          return { ...prev, [provider.id]: { ...old, state, outcome } };
        });
      };
      void run();
    });

    return () => controllers.forEach((c) => c.abort());
  }, [currentWord, definitionProviders, lang, pushWord, isDarkMode]);

  // Visible cards = providers that are still loading or finished with a
  // result. Empty/unsupported/error cards are removed entirely.
  const visibleDefinitionProviders = definitionProviders.filter((p) => {
    const card = cards[p.id];
    if (!card) return true;
    return card.state === 'loading' || card.state === 'loaded';
  });

  const resolveWebSearchUrl = useCallback(
    (id: string): string | undefined => {
      if (id.startsWith('web:builtin:')) {
        const tpl = getBuiltinWebSearch(id);
        return tpl ? substituteUrlTemplate(tpl.urlTemplate, currentWord) : undefined;
      }
      const list: WebSearchEntry[] = settings.webSearches ?? [];
      const tpl = list.find((t) => t.id === id);
      if (!tpl || tpl.deletedAt) return undefined;
      return substituteUrlTemplate(tpl.urlTemplate, currentWord);
    },
    [currentWord, settings.webSearches],
  );

  const onWebSearchClickTauri = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
      if (!isTauri) return;
      e.preventDefault();
      const url = resolveWebSearchUrl(id);
      if (!url) return;
      void openUrl(url).catch((err) => {
        console.warn('Failed to open external URL', url, err);
      });
    },
    [resolveWebSearchUrl],
  );

  const canGoBack = historyStack.length > 1;
  const noProvidersAtAll = providers.length === 0;

  return {
    currentWord,
    canGoBack,
    goBack,
    visibleDefinitionProviders,
    webSearchProviders,
    cards,
    setContainerRef,
    handleContainerClick,
    toggleExpanded,
    resolveWebSearchUrl,
    onWebSearchClickTauri,
    noProvidersAtAll,
  };
}

interface DictionaryResultsHeaderProps {
  currentWord: string;
  canGoBack: boolean;
  goBack: () => void;
  onManage?: () => void;
}

export const DictionaryResultsHeader: React.FC<DictionaryResultsHeaderProps> = ({
  currentWord,
  canGoBack,
  goBack,
  onManage,
}) => {
  const _ = useTranslation();
  return (
    <div className='-mt-3 flex h-8 w-full items-center justify-between px-2'>
      <div className='flex h-8 w-8 items-center justify-center'>
        {canGoBack ? (
          <button
            type='button'
            aria-label={_('Back')}
            onClick={goBack}
            className='btn btn-ghost btn-circle h-8 min-h-8 w-8'
          >
            <MdArrowBack size={20} />
          </button>
        ) : null}
      </div>
      <span data-testid='dict-title' className='line-clamp-1 flex-1 text-center font-bold'>
        {currentWord}
      </span>
      <div className='flex h-8 w-8 items-center justify-center'>
        {onManage ? (
          <button
            type='button'
            aria-label={_('Manage Dictionaries')}
            title={_('Manage Dictionaries')}
            onClick={onManage}
            className='btn btn-ghost btn-square btn-xs text-base-content/60 hover:text-base-content not-eink:hover:bg-base-200/60'
          >
            <MdSettings size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
};

interface DictionaryResultsBodyProps extends DictionaryResultsState {}

export const DictionaryResultsBody: React.FC<DictionaryResultsBodyProps> = ({
  visibleDefinitionProviders,
  webSearchProviders,
  cards,
  setContainerRef,
  handleContainerClick,
  toggleExpanded,
  resolveWebSearchUrl,
  onWebSearchClickTauri,
  noProvidersAtAll,
}) => {
  const _ = useTranslation();
  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-y-auto'>
        {noProvidersAtAll ? (
          <div className='flex h-full flex-col items-center justify-center px-6 text-center'>
            <h1 className='text-base font-bold'>{_('No dictionaries enabled')}</h1>
            <p className='not-eink:opacity-70 mt-2 text-sm'>
              {_('Enable a dictionary in Settings → Language → Dictionaries.')}
            </p>
          </div>
        ) : (
          <>
            {visibleDefinitionProviders.length > 0 && (
              <section className='px-4 pt-2'>
                <h3 className='not-eink:opacity-60 mb-2 text-xs font-medium uppercase tracking-wide'>
                  {_('Dictionaries')}
                </h3>
                <ul className='flex flex-col gap-3'>
                  {visibleDefinitionProviders.map((p) => {
                    const card = cards[p.id];
                    const isLoading = !card || card.state === 'loading';
                    const expanded = card?.expanded ?? false;
                    const sourceLabel =
                      card?.outcome?.ok && card.outcome.sourceLabel
                        ? card.outcome.sourceLabel
                        : _(p.label);
                    return (
                      <li key={p.id}>
                        <div
                          data-testid='dict-card'
                          role='button'
                          tabIndex={0}
                          aria-expanded={expanded}
                          onClick={(e) => {
                            const path = e.nativeEvent.composedPath();
                            for (const node of path) {
                              if (node === e.currentTarget) break;
                              if (node instanceof Element) {
                                const tag = node.tagName;
                                if (tag === 'A' || tag === 'BUTTON' || tag === 'IMG') return;
                              }
                            }
                            toggleExpanded(p.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleExpanded(p.id);
                            }
                          }}
                          className={clsx('cursor-pointer rounded-lg')}
                        >
                          {isLoading && (
                            <div
                              data-testid='dict-card-skeleton'
                              className='bg-base-200/50 h-12 animate-pulse rounded'
                            />
                          )}
                          <div
                            ref={setContainerRef(p.id)}
                            onClick={handleContainerClick}
                            className={clsx(
                              'font-sans',
                              isLoading && 'hidden',
                              !isLoading &&
                                !expanded &&
                                'line-clamp-4 max-h-40 overflow-hidden [-webkit-box-orient:vertical] [display:-webkit-box]',
                            )}
                          />
                          {!isLoading && (
                            <div className='border-base-content/10 -me-4 mt-2 border-b pb-2'>
                              <span className='not-eink:opacity-60 text-xs'>{sourceLabel}</span>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {webSearchProviders.length > 0 && (
              <section className='px-4 pt-4'>
                <h3 className='not-eink:opacity-60 mb-2 text-xs font-medium uppercase tracking-wide'>
                  {_('Search the web')}
                </h3>
                <ul className='flex flex-col'>
                  {webSearchProviders.map((p) => {
                    const url = resolveWebSearchUrl(p.id);
                    return (
                      <li key={p.id}>
                        <a
                          href={url ?? '#'}
                          target={isTauri ? undefined : '_blank'}
                          rel='noopener noreferrer'
                          onClick={(e) => onWebSearchClickTauri(e, p.id)}
                          className='hover:bg-base-200/40 flex w-full items-center justify-between rounded-md px-2 py-3 text-left text-sm no-underline'
                        >
                          <span>{_(p.label)}</span>
                          <MdChevronRight className='not-eink:opacity-60' size={18} />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
