import React, { useEffect, useRef, useState } from 'react';
import { MdArrowBack } from 'react-icons/md';
import { Position } from '@/utils/sel';
import { useTranslation } from '@/hooks/useTranslation';
import Popup from '@/components/Popup';

type Definition = {
  definition: string;
  examples?: string[];
};

type Result = {
  partOfSpeech: string;
  definitions: Definition[];
  language: string;
};

interface WiktionaryPopupProps {
  word: string;
  lang?: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

const WiktionaryPopup: React.FC<WiktionaryPopupProps> = ({
  word,
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const [history, setHistory] = useState<{ items: string[]; index: number }>({
    items: [word],
    index: 0,
  });
  const lastLookupRef = useRef('');
  const mainRef = useRef<HTMLElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const lastDirectionRef = useRef<'up' | 'down' | null>(null);
  const scrollDeltaRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [isBackVisible, setIsBackVisible] = useState(false);
  const lookupWord = history.items[history.index] ?? word;
  const canGoBack = history.index > 0;
  const showBackButton = canGoBack && isBackVisible;

  useEffect(() => {
    setHistory({ items: [word], index: 0 });
  }, [word]);

  useEffect(() => {
    if (!canGoBack) {
      setIsBackVisible(false);
      lastScrollTopRef.current = 0;
      lastDirectionRef.current = null;
      scrollDeltaRef.current = 0;
      return;
    }
    setIsBackVisible(true);
  }, [canGoBack]);

  useEffect(() => {
    if (!canGoBack) return;
    const main = mainRef.current;
    if (!main) return;

    const handleScroll = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const currentScrollTop = main.scrollTop;
        const delta = currentScrollTop - lastScrollTopRef.current;
        if (delta === 0) return;

        if (currentScrollTop <= 4) {
          setIsBackVisible(true);
          lastDirectionRef.current = null;
          scrollDeltaRef.current = 0;
          lastScrollTopRef.current = currentScrollTop;
          return;
        }

        const direction: 'up' | 'down' = delta > 0 ? 'down' : 'up';
        if (direction !== lastDirectionRef.current) {
          lastDirectionRef.current = direction;
          scrollDeltaRef.current = 0;
        }

        scrollDeltaRef.current += Math.abs(delta);
        const hideThreshold = 14;
        const showThreshold = 8;

        if (direction === 'down' && scrollDeltaRef.current >= hideThreshold) {
          setIsBackVisible(false);
          scrollDeltaRef.current = 0;
        } else if (direction === 'up' && scrollDeltaRef.current >= showThreshold) {
          setIsBackVisible(true);
          scrollDeltaRef.current = 0;
        }

        lastScrollTopRef.current = currentScrollTop;
      });
    };

    lastScrollTopRef.current = main.scrollTop;
    main.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', handleScroll);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [canGoBack]);

  useEffect(() => {
    setIsBackVisible(true);
    lastScrollTopRef.current = 0;
    lastDirectionRef.current = null;
    scrollDeltaRef.current = 0;
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
  }, [lookupWord]);

  const pushHistory = (nextWord: string) => {
    const trimmedWord = nextWord.trim();
    if (!trimmedWord) return;
    setHistory((prev) => {
      const currentWord = prev.items[prev.index];
      if (currentWord === trimmedWord) return prev;
      const items = [...prev.items.slice(0, prev.index + 1), trimmedWord];
      return { items, index: items.length - 1 };
    });
  };

  const handleBack = () => {
    setHistory((prev) => {
      if (prev.index === 0) return prev;
      return { ...prev, index: prev.index - 1 };
    });
  };

  const interceptDictLinks = (definition: string): HTMLElement[] => {
    const container = document.createElement('div');
    container.innerHTML = definition;

    const links = container.querySelectorAll<HTMLAnchorElement>('a[rel="mw:WikiLink"]');

    links.forEach((link) => {
      const title = link.getAttribute('title');
      if (title) {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          pushHistory(title);
        });

        link.className = 'text-primary underline cursor-pointer';
      }
    });

    return Array.from(container.childNodes) as HTMLElement[];
  };

  useEffect(() => {
    const langCode = typeof lang === 'string' ? lang : lang?.[0];
    const lookupKey = `${lookupWord}::${langCode || ''}`;
    if (lastLookupRef.current === lookupKey) return;
    lastLookupRef.current = lookupKey;
    const main = mainRef.current;
    const footer = footerRef.current;
    if (!main || !footer) return;

    const fetchDefinitions = async (word: string, language?: string) => {
      main.innerHTML = '';
      footer.dataset['state'] = 'loading';

      try {
        const response = await fetch(
          `https://en.wiktionary.org/api/rest_v1/page/definition/${word}`,
        );
        if (!response.ok) {
          throw new Error('Failed to fetch definitions');
        }

        const json = await response.json();
        const results: Result[] | undefined = language
          ? json[language] || json['en']
          : json[Object.keys(json)[0]!];

        if (!results || results.length === 0) {
          throw new Error('No results found');
        }

        const hgroup = document.createElement('hgroup');
        const h1 = document.createElement('h1');
        h1.innerText = word;
        h1.className = 'text-lg font-bold';

        const p = document.createElement('p');
        p.innerText = results[0]!.language;
        p.className = 'text-sm italic opacity-75';
        hgroup.append(h1, p);
        main.append(hgroup);

        results.forEach(({ partOfSpeech, definitions }: Result) => {
          const h2 = document.createElement('h2');
          h2.innerText = partOfSpeech;
          h2.className = 'text-base font-semibold mt-4';

          const ol = document.createElement('ol');
          ol.className = 'pl-8 list-decimal';

          definitions.forEach(({ definition, examples }: Definition) => {
            if (!definition) return;
            const li = document.createElement('li');
            const processedContent = interceptDictLinks(definition);
            li.append(...processedContent);

            if (examples) {
              const ul = document.createElement('ul');
              ul.className = 'pl-8 list-disc text-sm italic opacity-75';

              examples.forEach((example) => {
                const exampleLi = document.createElement('li');
                exampleLi.innerHTML = example;
                ul.appendChild(exampleLi);
              });

              li.appendChild(ul);
            }

            ol.appendChild(li);
          });

          main.appendChild(h2);
          main.appendChild(ol);
        });

        footer.dataset['state'] = 'loaded';
      } catch (error) {
        console.error(error);
        footer.dataset['state'] = 'error';

        const div = document.createElement('div');
        div.className =
          'flex flex-col items-center justify-center w-full h-full text-center absolute inset-0';

        const h1 = document.createElement('h1');
        h1.innerText = _('Error');
        h1.className = 'text-lg font-bold';

        const p = document.createElement('p');
        p.innerHTML = _('Unable to load the word. Try searching directly on {{link}}.', {
          link: `<a href="https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(
            word,
          )}" target="_blank" rel="noopener noreferrer" class="text-primary underline">Wiktionary</a>`,
        });

        div.append(h1, p);
        main.append(div);
      }
    };

    fetchDefinitions(lookupWord, langCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_, lookupWord, lang]);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        height={popupHeight}
        position={position}
        className='select-text'
        onDismiss={onDismiss}
      >
        <div className='relative flex h-full flex-col'>
          {canGoBack && (
            <button
              type='button'
              onClick={handleBack}
              aria-label={_('Back')}
              className={`btn btn-ghost btn-circle text-base-content bg-base-200/80 hover:bg-base-200 absolute left-2 top-2 h-8 min-h-8 w-8 p-0 shadow-sm transition-[opacity,transform] duration-200 ease-out ${
                showBackButton
                  ? 'translate-y-0 opacity-100'
                  : 'pointer-events-none -translate-y-1 opacity-0'
              }`}
            >
              <MdArrowBack size={18} />
            </button>
          )}
          <main
            ref={mainRef}
            className='flex-grow overflow-y-auto px-4 pb-4 font-sans'
            style={{
              paddingTop: showBackButton ? 48 : 16,
              transition: 'padding-top 180ms ease-out',
            }}
          />
          <footer
            ref={footerRef}
            className='mt-auto hidden data-[state=loaded]:block data-[state=error]:hidden data-[state=loading]:hidden'
          >
            <div className='flex items-center px-4 py-2 text-sm opacity-60'>
              Source: Wiktionary (CC BY-SA)
            </div>
          </footer>
        </div>
      </Popup>
    </div>
  );
};

export default WiktionaryPopup;
