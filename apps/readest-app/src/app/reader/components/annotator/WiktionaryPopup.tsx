import React, { useEffect, useRef, useState } from 'react';
import { Position } from '@/utils/sel';
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
}

const WiktionaryPopup: React.FC<WiktionaryPopupProps> = ({
  word,
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
}) => {
  const [lookupWord, setLookupWord] = useState(word);
  const isLookingUp = useRef(false);

  const interceptDictLinks = (definition: string): HTMLElement[] => {
    const container = document.createElement('div');
    container.innerHTML = definition;

    const links = container.querySelectorAll<HTMLAnchorElement>('a[rel="mw:WikiLink"]');

    links.forEach((link) => {
      const title = link.getAttribute('title');
      if (title) {
        link.addEventListener('click', (event) => {
          event.preventDefault();
          setLookupWord(title);
          isLookingUp.current = false;
        });

        link.className = 'text-primary underline cursor-pointer';
      }
    });

    return Array.from(container.childNodes) as HTMLElement[];
  };

  useEffect(() => {
    if (isLookingUp.current) {
      return;
    }
    isLookingUp.current = true;
    const main = document.querySelector('main') as HTMLElement;
    const footer = document.querySelector('footer') as HTMLElement;

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
        h1.innerText = 'Error';
        h1.className = 'text-lg font-bold';

        const p = document.createElement('p');
        p.innerHTML = `Unable to load the word. Try searching directly on <a href="https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(
          word,
        )}" target="_blank" rel="noopener noreferrer" class="text-primary underline">Wiktionary</a>.`;

        div.append(h1, p);
        main.append(div);
      }
    };

    const langCode = typeof lang === 'string' ? lang : lang?.[0];
    fetchDefinitions(lookupWord, langCode);
  }, [lookupWord, lang]);

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        height={popupHeight}
        position={position}
        className='select-text'
      >
        <div className='flex h-full flex-col'>
          <main className='flex-grow overflow-y-auto p-4 font-sans' />
          <footer className='mt-auto hidden data-[state=loaded]:block data-[state=error]:hidden data-[state=loading]:hidden'>
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
