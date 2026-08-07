import { useCallback, useEffect, useRef, useState } from 'react';
import { FoliateView } from '@/types/view';
import { UseTranslatorOptions } from '@/services/translators';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslator } from '@/hooks/useTranslator';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { walkTextNodes } from '@/utils/walk';
import { debounce } from '@/utils/debounce';
import { getLocale } from '@/utils/misc';
import { getDirFromLanguage } from '@/utils/rtl';
import { getTranslators } from '@/services/translators';
import {
  extractSourcePayload,
  sanitizeTranslatedMarkup,
  splitMarkupIntoChunks,
} from '@/app/reader/utils/translationMarkup';
import { splitTextIntoChunks } from '@/services/translators/utils';

/**
 * Markup inflates the payload and the provider's length cap counts the tags,
 * while the chunker splits on sentence boundaries and would cut through a tag.
 * Rather than build markup-aware chunking, longer formatted paragraphs fall
 * back to the plain-text path (losing formatting, exactly as before).
 *
 * Set to the verified hard limit of the only provider that currently opts in:
 * Bing accepts exactly 1000 UTF-16 code units and answers `statusCode: 400` at
 * 1001. Anything lower needlessly gives up formatting on paragraphs that would
 * have fit.
 */
const MAX_MARKUP_PAYLOAD_CHARS = 1000;

/**
 * Builds the node appended to a source paragraph to carry its translation.
 *
 * A single <font> rather than nested wrappers: it keeps the CFI path into
 * translated text two levels shallower, and puts `display: block` on the
 * element itself instead of on a block nested inside an inline parent. <font>
 * specifically because book CSS never targets it (so the wrapper picks up no
 * styling from the book) and because it is on INLINE_FORMATTING_TAGS, so the
 * enclosing source div keeps its paragraph layout.
 *
 * `content` may be a plain string or a sanitized fragment carrying the source's
 * inline formatting — the markup inside is *meant* to inherit the book's rules
 * so the translation matches the original's styling.
 */
export const createTranslationTargetNode = ({
  translatedText,
  content,
  lang,
  targetBlockClassName,
  hidden,
  widthLineBreak,
}: {
  translatedText?: string;
  content?: DocumentFragment;
  lang: string;
  targetBlockClassName: string;
  hidden: boolean;
  widthLineBreak: boolean;
}) => {
  const wrapper = document.createElement('font');
  wrapper.className = `translation-target ${targetBlockClassName} ${hidden ? 'hidden' : ''}`.trim();
  wrapper.setAttribute('translation-element-mark', '1');
  wrapper.setAttribute('lang', lang);
  // Set the base direction from the target language so justified RTL text
  // (e.g. Arabic) aligns to the start (right) instead of inheriting the
  // source document's LTR direction.
  wrapper.setAttribute('dir', getDirFromLanguage(lang));
  if (widthLineBreak) {
    wrapper.appendChild(document.createElement('br'));
  }

  if (content) {
    wrapper.appendChild(content);
  } else {
    wrapper.appendChild(document.createTextNode(translatedText ?? ''));
  }
  return wrapper;
};

const SOURCE_HIDDEN_CLASS = 'translation-source-hidden';

/**
 * Hides or restores a paragraph's original text.
 *
 * The original is wrapped in a `cfi-skip` element rather than having its text
 * erased. cfi-skip hoists the wrapper's children for indexing, so every source
 * text node keeps the exact index and offset it had unwrapped — a highlight on
 * the original still resolves whether or not the original is on screen. Erasing
 * the text (the previous approach) destroyed that anchor.
 */
export const setSourceVisibility = (el: HTMLElement, visible: boolean) => {
  const existing = el.querySelector(`:scope > .${SOURCE_HIDDEN_CLASS}`);
  if (visible) {
    if (existing) existing.replaceWith(...Array.from(existing.childNodes));
    return;
  }
  if (existing) return;

  const sourceNodes = Array.from(el.childNodes).filter(
    (node) =>
      !(node.nodeType === Node.ELEMENT_NODE && (node as Element).closest('.translation-target')),
  );
  if (!sourceNodes.length) return;

  const hider = document.createElement('font');
  hider.className = SOURCE_HIDDEN_CLASS;
  hider.setAttribute('cfi-skip', '');
  el.insertBefore(hider, sourceNodes[0]!);
  sourceNodes.forEach((node) => hider.appendChild(node));
};

export function useTextTranslation(
  bookKey: string,
  view: FoliateView | HTMLElement | null,
  widthLineBreak = false,
  targetBlockClassName = 'translation-target-block',
) {
  const _ = useTranslation();
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const setIsLoading = useReaderStore((s) => s.setIsLoading);
  const viewSettings = getViewSettings(bookKey);
  // Reactive: triggers translate-in-range on every page turn so the
  // visible viewport's translations refresh. Reads from
  // readerProgressStore only.
  const progress = useBookProgress(bookKey);

  const enabled = useRef(viewSettings?.translationEnabled);
  const [provider, setProvider] = useState(viewSettings?.translationProvider);
  const [targetLang, setTargetLang] = useState(viewSettings?.translateTargetLang);
  const showTranslateSourceRef = useRef(viewSettings?.showTranslateSource);

  const { translate } = useTranslator({
    provider,
    targetLang: targetLang || getLocale(),
  } as UseTranslatorOptions);

  const translateRef = useRef(translate);
  // `translationProvider` is a loose string in settings, so match by name
  // rather than narrowing to TranslatorName.
  const translatorPreservesMarkup = !!getTranslators().find(
    (translator) => translator.name === provider,
  )?.preservesMarkup;
  const observerRef = useRef<IntersectionObserver | null>(null);
  const translatedElements = useRef<HTMLElement[]>([]);
  const allTextNodes = useRef<HTMLElement[]>([]);
  const translationQueue = useRef<HTMLElement[]>([]);
  const activeTranslations = useRef(0);
  const MAX_CONCURRENT_TRANSLATIONS = 5;
  const pendingDOMUpdates = useRef<Array<() => void>>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleTranslationVisibility = (visible: boolean) => {
    translatedElements.current.forEach((element) => {
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => {
        if (visible) {
          target.classList.remove('hidden');
        } else {
          target.classList.add('hidden');
        }
      });
    });
  };

  useEffect(() => {
    translateRef.current = translate;
  }, [translate]);

  const hintInitialTranslating = () => {
    setIsLoading(bookKey, true);
    eventDispatcher.dispatch('hint', {
      bookKey,
      message: _('Translating...'),
    });
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      setIsLoading(bookKey, false);
    }, 2000);
  };

  const observeTextNodes = () => {
    if (!view || !enabled.current) return;

    const observer = createTranslationObserver();
    observerRef.current = observer;
    const nodes = walkTextNodes(view, ['pre', 'code', 'math']);
    console.log(
      'Observing text nodes for translation:',
      nodes.length,
      // nodes.map((n) => n.textContent),
    );
    allTextNodes.current = nodes;
    nodes.forEach((el) => observer.observe(el));
  };

  const updateTranslation = () => {
    translationQueue.current = [];
    activeTranslations.current = 0;
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    pendingDOMUpdates.current = [];
    translatedElements.current.forEach((element) => {
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => target.remove());
    });

    translatedElements.current = [];
    if (viewSettings?.translationEnabled && view) {
      recreateTranslationObserver();
    }
  };

  const createTranslationObserver = () => {
    const visibleElements = new Set<HTMLElement>();
    return new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleElements.add(entry.target as HTMLElement);
          } else {
            visibleElements.delete(entry.target as HTMLElement);
          }
        }

        if (visibleElements.size === 0) return;

        const nodes = allTextNodes.current;
        if (nodes.length === 0) return;

        let firstIdx = nodes.length;
        let lastIdx = -1;
        for (const el of visibleElements) {
          const idx = nodes.indexOf(el);
          if (idx !== -1) {
            if (idx < firstIdx) firstIdx = idx;
            if (idx > lastIdx) lastIdx = idx;
          }
        }

        if (lastIdx === -1) return;

        const startIdx = Math.max(0, firstIdx - 1);
        const endIdx = Math.min(nodes.length - 1, lastIdx + 2);

        for (let i = startIdx; i <= endIdx; i++) {
          const node = nodes[i];
          if (node) {
            scheduleTranslation(node);
          }
        }
      },
      { threshold: 0 },
    );
  };

  const scheduleTranslation = (el: HTMLElement) => {
    if (!enabled.current) return;
    if (el.classList.contains('translation-target')) return;
    if (el.querySelector('.translation-target')) return;
    if (translationQueue.current.indexOf(el) !== -1) return;
    translationQueue.current.push(el);
    drainTranslationQueue();
  };

  const drainTranslationQueue = () => {
    while (
      activeTranslations.current < MAX_CONCURRENT_TRANSLATIONS &&
      translationQueue.current.length > 0
    ) {
      const el = translationQueue.current.shift()!;
      if (el.querySelector('.translation-target') || !enabled.current) continue;
      activeTranslations.current++;
      translateElement(el).finally(() => {
        activeTranslations.current--;
        drainTranslationQueue();
      });
    }
    if (translationQueue.current.length === 0 && activeTranslations.current === 0) {
      setTimeout(() => {
        setIsLoading(bookKey, false);
      }, 500);
    }
  };

  const batchDOMUpdate = (update: () => void) => {
    pendingDOMUpdates.current.push(update);
    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(() => {
        batchTimerRef.current = null;
        const updates = pendingDOMUpdates.current.splice(0);
        updates.forEach((fn) => fn());
      }, 50);
    }
  };

  const recreateTranslationObserver = () => {
    const observer = createTranslationObserver();
    observerRef.current?.disconnect();
    observerRef.current = observer;
    allTextNodes.current.forEach((el) => observer.observe(el));
  };

  const translateElement = async (el: HTMLElement) => {
    if (!enabled.current) return;
    const text = el.textContent?.replaceAll('\n', '').trim();
    if (!text) return;

    if (el.classList.contains('translation-target')) {
      return;
    }

    const updateSourceNodes = (element: HTMLElement) => {
      element.classList.add('translation-source');
      setSourceVisibility(element, !!showTranslateSourceRef.current);
    };

    try {
      // Round-trip the paragraph's inline markup when the provider repositions
      // tags for us; otherwise send bare text. Markup is split at run
      // boundaries so a long formatted paragraph still keeps its formatting
      // instead of falling back — each chunk is well-formed on its own.
      const payload = extractSourcePayload(el);
      const markupChunks =
        translatorPreservesMarkup && payload.hasMarkup
          ? splitMarkupIntoChunks(payload.html, MAX_MARKUP_PAYLOAD_CHARS, splitTextIntoChunks)
          : [];
      const useMarkup = markupChunks.length > 0;

      const translated = await translateRef.current(useMarkup ? markupChunks : [text]);
      const translatedText = translated.join('');
      if (!translatedText || text === translatedText) return;

      let content: DocumentFragment | undefined;
      if (useMarkup) {
        // Sanitize per chunk: each was translated independently, and a chunk
        // that loses everything must not discard its siblings.
        const combined = el.ownerDocument.createDocumentFragment();
        for (const chunk of translated) {
          const part = sanitizeTranslatedMarkup(chunk, payload.allowedAttrs, el.ownerDocument);
          if (part) combined.appendChild(part);
        }
        content = combined.childNodes.length ? combined : undefined;
      }

      const wrapper = createTranslationTargetNode({
        // Falls back to the raw string when markup was not used or did not
        // survive sanitizing, which is exactly the previous behaviour.
        translatedText,
        content,
        lang: targetLang || getLocale(),
        targetBlockClassName,
        hidden: !enabled.current,
        widthLineBreak,
      });

      if (el.querySelector('.translation-target')) {
        return;
      }
      batchDOMUpdate(() => {
        if (!enabled.current || el.querySelector('.translation-target')) return;
        updateSourceNodes(el);
        el.appendChild(wrapper);
        translatedElements.current.push(el);
        // Translations land long after the section's annotations were drawn, so
        // any highlight anchored inside this paragraph has to be re-attached.
        eventDispatcher.dispatch('translation-inserted', { bookKey, element: el });
      });
    } catch (err) {
      console.warn('Translation failed:', err);
    }
  };

  const findNodeIndicesInRange = (range: Range, nodes: HTMLElement[]) => {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    let startIndex = -1;
    let endIndex = -1;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node === startContainer || node.contains(startContainer)) {
        if (startIndex === -1) startIndex = i;
      }
      if (node === endContainer || node.contains(endContainer)) {
        endIndex = i;
      }
    }
    if (startIndex !== -1 && endIndex === -1) {
      endIndex = startIndex;
    }

    return { startIndex, endIndex };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const translateInRange = useCallback(
    debounce((range: Range) => {
      const nodes = allTextNodes.current;
      if (nodes.length === 0) {
        console.warn('No text nodes available for translation.');
        return;
      }
      const { startIndex, endIndex } = findNodeIndicesInRange(range, nodes);
      if (startIndex === -1) {
        console.log('Range not found in text nodes');
        return;
      }
      const beforeContext = 2;
      const afterContext = 5;
      const beforeStart = Math.max(0, startIndex - beforeContext);
      const afterEnd = Math.min(nodes.length - 1, endIndex + afterContext);
      for (let i = beforeStart; i <= afterEnd; i++) {
        const node = nodes[i];
        if (node) {
          scheduleTranslation(node);
        }
      }
    }, 500),
    [scheduleTranslation],
  );

  useEffect(() => {
    if (enabled.current && progress) {
      const { range } = progress;
      translateInRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  useEffect(() => {
    if (!viewSettings) return;

    const enabledChanged = enabled.current !== viewSettings.translationEnabled;
    const providerChanged = provider !== viewSettings.translationProvider;
    const targetLangChanged = targetLang !== viewSettings.translateTargetLang;
    const showTranslateSourceChanged =
      showTranslateSourceRef.current !== viewSettings.showTranslateSource;

    if (enabledChanged) {
      enabled.current = viewSettings.translationEnabled;
    }

    if (providerChanged) {
      setProvider(viewSettings.translationProvider);
    }

    if (targetLangChanged) {
      setTargetLang(viewSettings.translateTargetLang);
    }

    if (showTranslateSourceChanged) {
      showTranslateSourceRef.current = viewSettings.showTranslateSource;
    }

    if (enabledChanged) {
      toggleTranslationVisibility(viewSettings.translationEnabled);
      if (enabled.current) {
        observeTextNodes();
      }
    } else if (providerChanged || targetLangChanged || showTranslateSourceChanged) {
      updateTranslation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, viewSettings, provider, targetLang]);

  useEffect(() => {
    if (!view || !enabled.current) return;

    if ('renderer' in view) {
      view.addEventListener('load', observeTextNodes);
      view.addEventListener('load', hintInitialTranslating);
    } else {
      observeTextNodes();
    }
    return () => {
      if ('renderer' in view) {
        view.removeEventListener('load', observeTextNodes);
        view.removeEventListener('load', hintInitialTranslating);
      }
      observerRef.current?.disconnect();
      translatedElements.current = [];
      translationQueue.current = [];
      activeTranslations.current = 0;
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      pendingDOMUpdates.current = [];
      setIsLoading(bookKey, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
}
