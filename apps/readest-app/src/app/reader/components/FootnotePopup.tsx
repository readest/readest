import React, { useEffect, useRef, useState } from 'react';

import { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useCustomFontStore } from '@/store/customFontStore';
import { getFootnoteStyles, getStyles, getThemeCode } from '@/utils/style';
import { getPopupPosition, getPosition, Position } from '@/utils/sel';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
import { mountAdditionalFonts, mountCustomFont } from '@/styles/fonts';
import { eventDispatcher } from '@/utils/event';
import { FoliateView } from '@/types/view';
import { isCJKLang } from '@/utils/lang';
import { Overlay } from '@/components/Overlay';
import Popup from '@/components/Popup';

interface FootnotePopupProps {
  bookKey: string;
  bookDoc: BookDoc;
}

const popupWidth = 360;
const popupHeight = 88;
const popupPadding = 10;

const FootnotePopup: React.FC<FootnotePopupProps> = ({ bookKey, bookDoc }) => {
  const footnoteRef = useRef<HTMLDivElement>(null);
  const footnoteViewRef = useRef<FoliateView | null>(null);
  const [trianglePosition, setTrianglePosition] = useState<Position | null>();
  const [popupPosition, setPopupPosition] = useState<Position | null>();
  const [showPopup, setShowPopup] = useState(false);

  const { getBookData } = useBookDataStore();
  const { getView, getViewSettings } = useReaderStore();
  const { getLoadedFonts } = useCustomFontStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const footnoteHandler = new FootnoteHandler();
  const containerRef = useRef<HTMLDivElement>(null);

  const [gridRect, setGridRect] = useState<DOMRect | null>(null);
  const [responsiveWidth, setResponsiveWidth] = useState(popupWidth);
  const [responsiveHeight, setResponsiveHeight] = useState(popupHeight);

  const getResponsivePopupSize = (size: number, isVertical: boolean) => {
    const maxSize = isVertical ? window.innerWidth / 2 : window.innerHeight / 2;
    return Math.min(size, maxSize - popupPadding - 12);
  };

  const clipPopupWith = (size: number) => {
    return Math.min(size, window.innerWidth - popupPadding - 12);
  };

  const clipPopupHeight = (size: number) => {
    return Math.min(size, window.innerHeight - popupPadding - 12);
  };

  useEffect(() => {
    const handleBeforeRender = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { view } = detail;
      view.addEventListener('link', (e: Event) => {
        e.preventDefault();
        const { detail: popupLinkDetail } = e as CustomEvent;
        popupLinkDetail['follow'] = true;
        footnoteHandler.handle(bookDoc, e)?.catch((err) => {
          console.warn(err);
          getView(bookKey)?.goTo(popupLinkDetail.href);
        });
      });
      view.addEventListener('load', (e: CustomEvent) => {
        const { doc } = e.detail;
        const bookData = getBookData(bookKey)!;
        mountAdditionalFonts(doc, isCJKLang(bookData.book?.primaryLanguage));
        getLoadedFonts().forEach((font) => {
          mountCustomFont(doc, font);
        });
      });
      footnoteViewRef.current = view;
      footnoteRef.current?.replaceChildren(view);
      const { renderer } = view;
      renderer.setAttribute('flow', 'scrolled');
      renderer.setAttribute('margin-top', '0px');
      renderer.setAttribute('margin-right', '0px');
      renderer.setAttribute('margin-bottom', '0px');
      renderer.setAttribute('margin-left', '0px');
      renderer.setAttribute('gap', '0%');
      const viewSettings = getViewSettings(bookKey)!;
      const themeCode = getThemeCode();
      const popupTheme = { ...themeCode };
      const popupContainer = document.getElementById('popup-container');
      if (popupContainer) {
        const backgroundColor = getComputedStyle(popupContainer).backgroundColor;
        popupTheme.bg = backgroundColor;
      }
      const mainStyles = getStyles(viewSettings, popupTheme);
      const footnoteStyles = getFootnoteStyles();
      renderer.setStyles?.(`${mainStyles}\n${footnoteStyles}`);
    };

    const handleRender = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // console.log('render footnote', detail);
      const { view } = detail;
      view.addEventListener('relocate', () => {
        const { renderer } = view as FoliateView;
        const viewSettings = getViewSettings(bookKey)!;
        if (viewSettings.vertical) {
          setResponsiveWidth(clipPopupWith(getResponsivePopupSize(renderer.viewSize, true)));
        } else {
          setResponsiveHeight(clipPopupHeight(getResponsivePopupSize(renderer.viewSize, false)));
        }
        setShowPopup(true);
      });
    };

    footnoteHandler.addEventListener('before-render', handleBeforeRender);
    footnoteHandler.addEventListener('render', handleRender);
    return () => {
      footnoteHandler.removeEventListener('before-render', handleBeforeRender);
      footnoteHandler.removeEventListener('render', handleRender);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (showPopup) {
      containerRef.current?.focus();
    }
  }, [showPopup]);

  useEffect(() => {
    if (viewSettings.vertical) {
      setResponsiveWidth(clipPopupWith(popupHeight));
      setResponsiveHeight(clipPopupHeight(Math.max(popupWidth, window.innerHeight / 4)));
    } else {
      setResponsiveWidth(clipPopupWith(Math.max(popupWidth, window.innerWidth / 4)));
      setResponsiveHeight(clipPopupHeight(popupHeight));
    }
  }, [viewSettings]);

  useEffect(() => {
    if (trianglePosition && gridRect) {
      const popupPos = getPopupPosition(
        trianglePosition,
        gridRect,
        responsiveWidth,
        responsiveHeight,
        popupPadding,
      );
      setPopupPosition(popupPos);
    }
  }, [trianglePosition, gridRect, responsiveWidth, responsiveHeight]);

  const docLinkHandler = async (event: Event) => {
    const detail = (event as CustomEvent).detail;
    // console.log('doc link click', detail);
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(detail.a, rect, popupPadding, viewSettings.vertical);
    setGridRect(rect);
    setTrianglePosition(triangPos);

    const { a: anchor } = detail as { a: HTMLAnchorElement };
    const footnoteClasses = ['duokan-footnote', 'footnote-link', 'footnote'];
    if (footnoteClasses.some((cls) => anchor.classList.contains(cls))) {
      detail['follow'] = true;
    }
    footnoteHandler.handle(bookDoc, event)?.catch((err) => {
      console.warn(err);
      const detail = (event as CustomEvent).detail;
      view?.goTo(detail.href);
    });
  };

  const closePopup = () => {
    const view = footnoteRef.current?.querySelector('foliate-view') as FoliateView;
    view?.close();
    view?.remove();
  };

  const handleDismissPopup = () => {
    closePopup();
    setGridRect(null);
    setPopupPosition(null);
    setTrianglePosition(null);
    setShowPopup(false);
  };

  // Handle custom footnote popup event from iframe event
  const handleFootnotePopupEvent = (event: CustomEvent) => {
    const { element, footnote } = event.detail;
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(element, rect, popupPadding, viewSettings.vertical);
    if (footnoteRef.current) {
      const elem = document.createElement('p');
      elem.textContent = footnote;
      elem.setAttribute('style', `padding: 1em; hanging-punctuation: allow-end last;`);
      elem.style.visibility = 'hidden';
      if (viewSettings.vertical) {
        elem.style.height = `${responsiveHeight}px`;
      } else {
        elem.style.width = `${responsiveWidth}px`;
      }
      document.body.appendChild(elem);
      const popupSize = elem.getBoundingClientRect();
      if (viewSettings.vertical) {
        setResponsiveWidth(getResponsivePopupSize(popupSize.width, true));
      } else {
        setResponsiveHeight(getResponsivePopupSize(popupSize.height, false));
      }
      document.body.removeChild(elem);

      elem.style.visibility = 'visible';
      footnoteRef.current.replaceChildren(elem);
      setGridRect(rect);
      setTrianglePosition(triangPos);
      setShowPopup(true);
    }
  };

  useFoliateEvents(view, {
    onLinkClick: docLinkHandler,
  });

  useEffect(() => {
    window.addEventListener('resize', handleDismissPopup);
    eventDispatcher.on('footnote-popup', handleFootnotePopupEvent);
    return () => {
      window.removeEventListener('resize', handleDismissPopup);
      eventDispatcher.off('footnote-popup', handleFootnotePopupEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (footnoteViewRef.current) {
      footnoteRef.current?.replaceChildren(footnoteViewRef.current);
    }
  }, [footnoteRef]);

  return (
    <div ref={containerRef} role='toolbar' tabIndex={-1}>
      {showPopup && <Overlay onDismiss={handleDismissPopup} />}
      <Popup
        isOpen={showPopup}
        width={responsiveWidth}
        height={responsiveHeight}
        position={showPopup ? popupPosition! : undefined}
        trianglePosition={showPopup ? trianglePosition! : undefined}
        className='select-text overflow-y-auto'
        onDismiss={handleDismissPopup}
      >
        <div
          className='footnote-content'
          ref={footnoteRef}
          style={{
            width: `${responsiveWidth}px`,
            height: `${responsiveHeight}px`,
          }}
        ></div>
      </Popup>
    </div>
  );
};

export default FootnotePopup;
