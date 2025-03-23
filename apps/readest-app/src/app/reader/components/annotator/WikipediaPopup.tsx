import React, { useEffect, useRef } from 'react';
import Popup from '@/components/Popup';
import { Position } from '@/utils/sel';

interface WikipediaPopupProps {
  text: string;
  lang: string;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
}

const WikipediaPopup: React.FC<WikipediaPopupProps> = ({
  text,
  lang,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
}) => {
  const isLoading = useRef(false);

  useEffect(() => {
    if (isLoading.current) {
      return;
    }
    isLoading.current = true;

    const main = document.querySelector('main') as HTMLElement;
    const footer = document.querySelector('footer') as HTMLElement;

    const fetchSummary = async (query: string, language: string) => {
      main.innerHTML = '';
      footer.dataset['state'] = 'loading';

      try {
        const response = await fetch(
          `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
        );

        if (!response.ok) {
          throw new Error('Failed to fetch Wikipedia summary');
        }

        const data = await response.json();

        const hgroup = document.createElement('hgroup');
        hgroup.style.color = 'white';
        hgroup.style.backgroundPosition = 'center center';
        hgroup.style.backgroundSize = 'cover';
        hgroup.style.backgroundColor = 'rgba(0, 0, 0, .4)';
        hgroup.style.backgroundBlendMode = 'darken';
        hgroup.style.borderRadius = '6px';
        hgroup.style.padding = '12px';
        hgroup.style.marginBottom = '12px';
        hgroup.style.minHeight = '100px';

        const h1 = document.createElement('h1');
        h1.innerHTML = data.titles.display;
        h1.className = 'text-lg font-bold';
        hgroup.append(h1);

        if (data.description) {
          const description = document.createElement('p');
          description.innerText = data.description;
          hgroup.appendChild(description);
        }

        if (data.thumbnail) {
          hgroup.style.backgroundImage = `url("${data.thumbnail.source}")`;
        }

        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = data.extract_html;
        contentDiv.className = 'p-2 text-sm';
        contentDiv.dir = data.dir;

        main.append(hgroup, contentDiv);
        footer.dataset['state'] = 'loaded';
      } catch (error) {
        console.error(error);

        const errorDiv = document.createElement('div');
        const h1 = document.createElement('h1');
        h1.innerText = 'Error';

        const errorMsg = document.createElement('p');
        errorMsg.innerHTML = `Unable to load the article. Try searching directly on <a href="https://${language}.wikipedia.org/w/index.php?search=${encodeURIComponent(
          query,
        )}" target="_blank" rel="noopener noreferrer" class="text-primary underline">Wikipedia</a>.`;

        errorDiv.append(h1, errorMsg);
        main.appendChild(errorDiv);
        footer.dataset['state'] = 'error';
      }
    };

    const bookLang = typeof lang === 'string' ? lang : lang?.[0];
    const langCode = bookLang ? bookLang.split('-')[0]! : 'en';
    fetchSummary(text, langCode);
  }, [text, lang]);

  return (
    <div>
      <Popup
        width={popupWidth}
        height={popupHeight}
        position={position}
        trianglePosition={trianglePosition}
        className='select-text'
      >
        <div className='text-base-content flex h-full flex-col pt-2'>
          <main className='flex-grow overflow-y-auto px-2 font-sans'></main>
          <footer className='mt-auto hidden data-[state=loaded]:block data-[state=error]:hidden data-[state=loading]:hidden'>
            <div className='flex items-center px-4 py-2 text-sm opacity-60'>
              Source: Wikipedia (CC BY-SA)
            </div>
          </footer>
        </div>
      </Popup>
    </div>
  );
};

export default WikipediaPopup;
