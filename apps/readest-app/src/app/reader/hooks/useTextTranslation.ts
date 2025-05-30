import { useEffect, useRef, useState } from 'react';
import { FoliateView } from '@/types/view';
import { UseTranslatorOptions } from '@/services/translators';
import { useReaderStore } from '@/store/readerStore';
import { useTranslator } from '@/hooks/useTranslator';
import { walkTextNodes } from '@/utils/walk';
import { localeToLang } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

export function useTextTranslation(bookKey: string, view: FoliateView | HTMLElement | null) {
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const enabled = useRef(viewSettings?.translationEnabled);
  const [provider, setProvider] = useState(viewSettings?.translationProvider);
  const [targetLang, setTargetLang] = useState(viewSettings?.translateTargetLang);

  const { translate } = useTranslator({
    provider,
    targetLang: localeToLang(targetLang || getLocale()),
  } as UseTranslatorOptions);

  const translateRef = useRef(translate);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const translatedElements = useRef<HTMLElement[]>([]);
  const allTextNodes = useRef<HTMLElement[]>([]);

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

  const observeTextNodes = () => {
    if (!view || !enabled.current) return;
    const observer = createTranslationObserver();
    observerRef.current = observer;
    const nodes = walkTextNodes(view);
    console.log('Observing text nodes for translation:', nodes.length);
    allTextNodes.current = nodes;
    nodes.forEach((el) => observer.observe(el));
  };

  const updateTranslation = () => {
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
    return new IntersectionObserver(
      (entries) => {
        let beforeIntersectedElement: HTMLElement | null = null;
        let lastIntersectedElement: HTMLElement | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            if (!lastIntersectedElement) {
              beforeIntersectedElement = entry.target as HTMLElement;
            }
            continue;
          }
          const currentElement = entry.target as HTMLElement;
          translateElement(currentElement);
          lastIntersectedElement = currentElement;
        }
        if (beforeIntersectedElement) {
          translateElement(beforeIntersectedElement);
        }
        if (lastIntersectedElement) {
          preTranslateNextElements(lastIntersectedElement, 2);
        }
      },
      {
        rootMargin: '1280px',
        threshold: 0,
      },
    );
  };

  const preTranslateNextElements = (currentElement: HTMLElement, count: number) => {
    if (!allTextNodes.current || count <= 0) return;
    const currentIndex = allTextNodes.current.indexOf(currentElement);
    if (currentIndex === -1) {
      return;
    }

    const nextElements = allTextNodes.current.slice(currentIndex + 1, currentIndex + 1 + count);
    nextElements.forEach((element, index) => {
      setTimeout(() => {
        translateElement(element);
      }, index * 500);
    });
  };

  const recreateTranslationObserver = () => {
    const observer = createTranslationObserver();
    observerRef.current?.disconnect();
    observerRef.current = observer;
    allTextNodes.current.forEach((el) => observer.observe(el));
  };

  const translateElement = async (el: HTMLElement) => {
    if (!enabled.current) return;
    const text = el.textContent?.trim();
    if (!text) return;

    if (el.querySelector('.translation-target')) {
      return;
    }

    try {
      const translated = await translateRef.current([text]);
      const translatedText = translated[0];
      if (!translatedText || text === translatedText) return;

      const wrapper = document.createElement('font');
      wrapper.className = `translation-target ${!enabled.current ? 'hidden' : ''}`;
      wrapper.setAttribute('translation-element-mark', '1');
      wrapper.setAttribute('lang', targetLang || getLocale());
      wrapper.appendChild(document.createElement('br'));

      const blockWrapper = document.createElement('font');
      blockWrapper.className = 'translation-target translation-block-wrapper';

      const inner = document.createElement('font');
      inner.className = 'translation-target target-inner target-inner-theme-none';
      inner.textContent = translatedText;

      blockWrapper.appendChild(inner);
      wrapper.appendChild(blockWrapper);

      if (el.querySelector('.translation-target')) {
        return;
      }
      el.appendChild(wrapper);
      translatedElements.current.push(el);
    } catch (err) {
      console.warn('Translation failed:', err);
    }
  };

  useEffect(() => {
    if (!viewSettings) return;

    const enabledChanged = enabled.current !== viewSettings.translationEnabled;
    const providerChanged = provider !== viewSettings.translationProvider;
    const targetLangChanged = targetLang !== viewSettings.translateTargetLang;

    if (enabledChanged) {
      enabled.current = viewSettings.translationEnabled;
    }

    if (providerChanged) {
      setProvider(viewSettings.translationProvider);
    }

    if (targetLangChanged) {
      setTargetLang(viewSettings.translateTargetLang);
    }

    if (enabledChanged) {
      toggleTranslationVisibility(viewSettings.translationEnabled);
      if (enabled.current) {
        observeTextNodes();
      }
    } else if (providerChanged || targetLangChanged) {
      updateTranslation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, viewSettings, provider, targetLang]);

  useEffect(() => {
    if (!view || !enabled.current) return;

    if ('renderer' in view) {
      view.addEventListener('load', observeTextNodes);
    } else {
      observeTextNodes();
    }
    return () => {
      if ('renderer' in view) {
        view.removeEventListener('load', observeTextNodes);
      }
      observerRef.current?.disconnect();
      translatedElements.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
}
