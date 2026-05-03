import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MdArrowBack, MdSettings } from 'react-icons/md';
import clsx from 'clsx';
import { openUrl } from '@tauri-apps/plugin-opener';

import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';
import { getEnabledProviders } from '@/services/dictionaries/registry';
import { isTauriAppPlatform } from '@/services/environment';
import type { DictionaryProvider, DictionaryLookupOutcome } from '@/services/dictionaries/types';

const isTauri = isTauriAppPlatform();

interface DictionaryPopupProps {
  word: string;
  lang?: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
  /**
   * Invoked when the user clicks the bottom-right "Manage Dictionaries"
   * icon. The host (Annotator) decides how to navigate — typically by
   * opening the SettingsDialog and deep-linking to the dictionaries
   * sub-page.
   */
  onManage?: () => void;
}

interface TabState {
  history: { items: string[]; index: number };
  loadKey: string;
  state: 'idle' | 'loading' | 'loaded' | 'empty' | 'error' | 'unsupported';
  outcome?: DictionaryLookupOutcome;
}

const initialTabState = (word: string): TabState => ({
  history: { items: [word], index: 0 },
  loadKey: '',
  state: 'idle',
});

const DictionaryPopup: React.FC<DictionaryPopupProps> = ({
  word,
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onManage,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { dictionaries, settings, setDefaultProviderId, saveCustomDictionaries } =
    useCustomDictionaryStore();

  // Compute the enabled-provider list, then memoize by the resulting ID
  // signature so unrelated settings tweaks (e.g. `setDefaultProviderId`
  // saving the last-used tab) don't change the array reference and trigger
  // a spurious lookup-effect re-fire mid-init.
  const computedProviders = getEnabledProviders({
    settings,
    dictionaries,
    fs: appService ?? undefined,
  });
  const providersSignature = computedProviders.map((p) => p.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const providers = useMemo<DictionaryProvider[]>(() => computedProviders, [providersSignature]);

  const fallbackTabId = providers[0]?.id;
  const initialTab = useMemo(() => {
    if (!providers.length) return undefined;
    if (settings.defaultProviderId && providers.some((p) => p.id === settings.defaultProviderId)) {
      return settings.defaultProviderId;
    }
    return fallbackTabId;
  }, [providers, settings.defaultProviderId, fallbackTabId]);

  const [activeTab, setActiveTab] = useState<string | undefined>(initialTab);
  const [tabStates, setTabStates] = useState<Record<string, TabState>>(() => {
    const seed: Record<string, TabState> = {};
    providers.forEach((p) => {
      seed[p.id] = initialTabState(word);
    });
    return seed;
  });

  // Reset all tabs when the looked-up word changes from outside.
  useEffect(() => {
    setTabStates((prev) => {
      const next: Record<string, TabState> = {};
      for (const provider of providers) {
        const old = prev[provider.id];
        if (old && old.history.items[0] === word && old.history.index === 0) {
          next[provider.id] = old;
        } else {
          next[provider.id] = initialTabState(word);
        }
      }
      return next;
    });
  }, [word, providers]);

  // If the persisted defaultProviderId disappears (provider disabled / removed),
  // fall back to the first available tab.
  useEffect(() => {
    if (!providers.length) {
      if (activeTab !== undefined) setActiveTab(undefined);
      return;
    }
    if (!activeTab || !providers.some((p) => p.id === activeTab)) {
      setActiveTab(fallbackTabId);
    }
  }, [providers, activeTab, fallbackTabId]);

  // Persist last-active tab as the user switches.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!activeTab) return;
    if (settings.defaultProviderId === activeTab) return;
    setDefaultProviderId(activeTab);
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void saveCustomDictionaries(envConfig).catch(() => {});
    }, 500);
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [
    activeTab,
    settings.defaultProviderId,
    setDefaultProviderId,
    saveCustomDictionaries,
    envConfig,
  ]);

  // Per-tab DOM container refs. Providers render into these.
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setContainerRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) containerRefs.current.set(id, el);
      else containerRefs.current.delete(id);
    },
    [],
  );

  /**
   * Click delegation for provider-rendered anchors.
   *
   * Providers (Wikipedia "Read on Wikipedia →", error placeholders, etc.)
   * append `<a>` elements imperatively to `ctx.container`. Those elements
   * can't use the React `Link` component, so route external http(s)
   * clicks through Tauri's `openUrl` here. Internal clicks (relative
   * `/wiki/...` links from Wiktionary, intercepted by the provider for
   * in-popup history) keep their existing behaviour — we only act when
   * the raw `href` attribute starts with `http(s)://`.
   */
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (!isTauri) return; // Non-Tauri: target="_blank" + rel handles it.
    if (e.defaultPrevented) return; // Provider already handled it.
    const anchor = (e.target as Element | null)?.closest?.('a');
    if (!anchor) return;
    const rawHref = anchor.getAttribute('href');
    if (!rawHref || !/^https?:\/\//i.test(rawHref)) return;
    e.preventDefault();
    void openUrl(rawHref).catch((err) => {
      console.warn('Failed to open external URL', rawHref, err);
    });
  }, []);

  const pushHistory = useCallback((tabId: string, nextWord: string) => {
    const trimmed = nextWord.trim();
    if (!trimmed) return;
    setTabStates((prev) => {
      const old = prev[tabId];
      if (!old) return prev;
      const currentWord = old.history.items[old.history.index];
      if (currentWord === trimmed) return prev;
      const items = [...old.history.items.slice(0, old.history.index + 1), trimmed];
      return {
        ...prev,
        [tabId]: { ...old, history: { items, index: items.length - 1 } },
      };
    });
  }, []);

  const goBack = useCallback((tabId: string) => {
    setTabStates((prev) => {
      const old = prev[tabId];
      if (!old || old.history.index === 0) return prev;
      return {
        ...prev,
        [tabId]: { ...old, history: { ...old.history, index: old.history.index - 1 } },
      };
    });
  }, []);

  const activeTabState = activeTab ? tabStates[activeTab] : undefined;
  const lookupIndex = activeTabState?.history.index ?? 0;
  const lookupWord = activeTabState?.history.items[lookupIndex] ?? word;
  const lookupLoadKey = activeTabState?.loadKey ?? '';
  const lookupState = activeTabState?.state;

  // Lookup effect — runs whenever the active tab's lookupWord changes (initial
  // activation, history navigation, or word prop changes).
  useEffect(() => {
    if (!activeTab) return;
    if (!activeTabState) return;
    const provider = providers.find((p) => p.id === activeTab);
    if (!provider) return;
    const langCode = typeof lang === 'string' ? lang : Array.isArray(lang) ? lang[0] : undefined;
    const loadKey = `${lookupWord}::${langCode || ''}`;
    // Skip only when we already have a settled outcome for this loadKey.
    // We must NOT skip on `state==='loading'`: a previous effect cleanup
    // may have aborted the in-flight run before it could update state, in
    // which case the next fire is the only chance to actually load the
    // result. Skipping here would deadlock the tab on the spinner.
    const isSettled =
      lookupState === 'loaded' ||
      lookupState === 'empty' ||
      lookupState === 'error' ||
      lookupState === 'unsupported';
    if (lookupLoadKey === loadKey && isSettled) return;

    const container = containerRefs.current.get(activeTab);
    if (!container) return;
    container.replaceChildren();
    container.scrollTop = 0;

    const controller = new AbortController();
    setTabStates((prev) => {
      const old = prev[activeTab];
      if (!old) return prev;
      return { ...prev, [activeTab]: { ...old, loadKey, state: 'loading' } };
    });

    let cancelled = false;
    const run = async () => {
      let outcome: DictionaryLookupOutcome;
      try {
        if (provider.init) await provider.init();
        outcome = await provider.lookup(lookupWord, {
          lang: langCode,
          signal: controller.signal,
          container,
          onNavigate: (next) => pushHistory(activeTab, next),
        });
      } catch (error) {
        outcome = {
          ok: false,
          reason: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (cancelled || controller.signal.aborted) return;
      if (!outcome.ok && container.childElementCount === 0) {
        renderErrorPlaceholder(container, lookupWord, outcome, _);
      }
      const state = outcome.ok
        ? 'loaded'
        : outcome.reason === 'empty'
          ? 'empty'
          : outcome.reason === 'unsupported'
            ? 'unsupported'
            : 'error';
      setTabStates((prev) => {
        const old = prev[activeTab];
        if (!old || old.loadKey !== loadKey) return prev;
        return { ...prev, [activeTab]: { ...old, state, outcome } };
      });
    };
    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, providers, lookupWord, lang, lookupIndex]);

  const canGoBack = !!activeTabState && activeTabState.history.index > 0;

  const sourceLabel =
    activeTabState?.outcome?.ok && activeTabState.outcome.sourceLabel
      ? activeTabState.outcome.sourceLabel
      : undefined;

  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={trianglePosition}
      className='select-text'
      onDismiss={onDismiss}
    >
      {/* `overflow-hidden rounded-lg` clips child surfaces (the tab strip's
          gray bg, the bottom footer divider, etc.) to the popup's rounded
          shape — without it the tab bar's `bg-base-300/40` and `border-b`
          paint into the corner area and break the rounded edge. */}
      <div className='relative flex h-full flex-col overflow-hidden rounded-lg'>
        {providers.length > 1 && (
          <div
            role='tablist'
            className='tabs tabs-bordered border-base-content/10 not-eink:bg-base-300/40 flex shrink-0 border-b'
          >
            {providers.map((p) => {
              const isActive = p.id === activeTab;
              return (
                <button
                  key={p.id}
                  type='button'
                  role='tab'
                  aria-selected={isActive}
                  onClick={() => setActiveTab(p.id)}
                  title={_(p.label)}
                  className={clsx(
                    'tab !grid min-w-0 max-w-max flex-1 px-2 text-sm',
                    isActive
                      ? 'tab-active text-base-content'
                      : 'text-base-content/70 hover:text-base-content',
                  )}
                >
                  {/* Phantom: invisible, always bold. Defines the cell's
                      max-content width so it doesn't change with active state. */}
                  <span
                    aria-hidden
                    className='invisible col-start-1 row-start-1 w-full truncate text-left font-semibold'
                  >
                    {_(p.label)}
                  </span>
                  {/* Visible label stacked over the phantom in the same cell. */}
                  <span
                    className={clsx(
                      'col-start-1 row-start-1 w-full truncate text-left',
                      isActive && 'font-semibold',
                    )}
                  >
                    {_(p.label)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {providers.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center px-6 text-center'>
            <h1 className='text-base font-bold'>{_('No dictionaries enabled')}</h1>
            <p className='not-eink:opacity-70 mt-2 text-sm'>
              {_('Enable a dictionary in Settings → Language → Dictionaries.')}
            </p>
          </div>
        ) : (
          providers.map((p) => {
            const isActive = p.id === activeTab;
            const state = tabStates[p.id]?.state ?? 'idle';
            const showBack = isActive && canGoBack;
            return (
              <div
                key={p.id}
                role='tabpanel'
                hidden={!isActive}
                className={clsx('relative min-h-0 flex-1', isActive ? 'flex flex-col' : 'hidden')}
              >
                {showBack && (
                  <button
                    type='button'
                    onClick={() => goBack(p.id)}
                    aria-label={_('Back')}
                    className='btn btn-ghost btn-circle text-base-content bg-base-200/80 hover:bg-base-200 absolute left-2 top-2 z-10 h-8 min-h-8 w-8 p-0 shadow-sm'
                  >
                    <MdArrowBack size={18} />
                  </button>
                )}
                <div
                  ref={setContainerRef(p.id)}
                  data-state={state}
                  onClick={handleContainerClick}
                  className='flex-grow overflow-y-auto px-4 pb-4 font-sans'
                  style={{ paddingTop: showBack ? 48 : 16 }}
                />
                {isActive && state === 'loading' && (
                  <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                    <span className='loading loading-spinner loading-md not-eink:opacity-60' />
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Footer always renders so the manage-dictionaries icon has a
            consistent home at the bottom-right of every tab. The source
            label fills the left side when present; otherwise the spacer
            pushes the icon to the right. */}
        {(sourceLabel || onManage) && (
          <footer className='mt-auto flex shrink-0 items-center gap-2 px-3 py-1.5'>
            {sourceLabel ? (
              <span
                className='not-eink:opacity-60 min-w-0 flex-1 truncate text-sm'
                title={`Source: ${sourceLabel}`}
              >
                Source: {sourceLabel}
              </span>
            ) : (
              <span className='flex-1' />
            )}
            {onManage && (
              <button
                type='button'
                onClick={onManage}
                aria-label={_('Manage Dictionaries')}
                title={_('Manage Dictionaries')}
                className='btn btn-ghost btn-square btn-xs text-base-content/60 hover:text-base-content not-eink:hover:bg-base-200/60 shrink-0'
              >
                <MdSettings size={16} />
              </button>
            )}
          </footer>
        )}
      </div>
    </Popup>
  );
};

const renderErrorPlaceholder = (
  container: HTMLElement,
  word: string,
  outcome: DictionaryLookupOutcome,
  _: (key: string, opts?: Record<string, string | number>) => string,
): void => {
  const wrapper = document.createElement('div');
  wrapper.className =
    'flex flex-col items-center justify-center w-full h-full text-center absolute inset-0 px-6';
  const h1 = document.createElement('h1');
  h1.className = 'text-base font-bold';
  const p = document.createElement('p');
  p.className = 'mt-2 text-sm not-eink:opacity-75';

  if (!outcome.ok && outcome.reason === 'empty') {
    h1.innerText = _('No definitions found');
    // Skip target="_blank" on Tauri — see the comment in
    // `wikipediaProvider.ts`. The popup's container click handler routes
    // the click through `openUrl` for Tauri.
    const targetAttr = isTauri ? '' : ' target="_blank"';
    p.innerHTML = _('Search for {{word}} on the web.', {
      word: `<a href="https://www.google.com/search?q=${encodeURIComponent(
        word,
      )}"${targetAttr} rel="noopener noreferrer" class="not-eink:text-primary underline">${word}</a>`,
    });
  } else if (!outcome.ok && outcome.reason === 'unsupported') {
    h1.innerText = _('Dictionary unsupported');
    p.innerText = outcome.message ?? _('This dictionary format is not supported yet.');
  } else {
    h1.innerText = _('Error');
    p.innerText = (!outcome.ok && outcome.message) || _('Unable to load the word.');
  }

  wrapper.append(h1, p);
  container.append(wrapper);
};

export default DictionaryPopup;
