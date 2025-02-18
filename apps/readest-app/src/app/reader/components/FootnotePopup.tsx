import React, { useEffect, useRef, useState } from 'react';

import { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useTheme } from '@/hooks/useTheme';
import { getFootnoteStyles, getStyles } from '@/utils/style';
import { getPopupPosition, getPosition, Position } from '@/utils/sel';
import { eventDispatcher } from '@/utils/event';
import { FoliateView } from '@/types/view';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
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
  const { getView, getViewSettings } = useReaderStore();
  const { themeCode } = useTheme();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const footnoteHandler = new FootnoteHandler();

  useEffect(() => {
    const handleBeforeRender = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { view } = detail;
      footnoteViewRef.current = view;
      footnoteRef.current?.replaceChildren(view);
      const { renderer } = view;
      renderer.setAttribute('flow', 'scrolled');
      renderer.setAttribute('margin', '0px');
      renderer.setAttribute('gap', '5%');
      const viewSettings = getViewSettings(bookKey)!;
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
      console.log('render footnote', detail);
      setShowPopup(true);
    };

    footnoteHandler.addEventListener('before-render', handleBeforeRender);
    footnoteHandler.addEventListener('render', handleRender);
    return () => {
      footnoteHandler.removeEventListener('before-render', handleBeforeRender);
      footnoteHandler.removeEventListener('render', handleRender);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, themeCode]);

  const docLinkHandler = async (event: Event) => {
    const detail = (event as CustomEvent).detail;
    console.log('doc link click', detail);
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(detail.a, rect, viewSettings.vertical);
    const popupPos = getPopupPosition(
      triangPos,
      rect,
      viewSettings.vertical ? popupHeight : popupWidth,
      viewSettings.vertical ? popupWidth : popupHeight,
      popupPadding,
    );
    setTrianglePosition(triangPos);
    setPopupPosition(popupPos);

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
    setPopupPosition(null);
    setTrianglePosition(null);
    setShowPopup(false);
  };

  const handleFootnotePopupEvent = (event: CustomEvent) => {
    const { element, footnote } = event.detail;
    const gridFrame = document.querySelector(`#gridcell-${bookKey}`);
    if (!gridFrame) return;
    const rect = gridFrame.getBoundingClientRect();
    const viewSettings = getViewSettings(bookKey)!;
    const triangPos = getPosition(element, rect, viewSettings.vertical);
    const popupPos = getPopupPosition(
      triangPos,
      rect,
      viewSettings.vertical ? popupHeight : popupWidth,
      viewSettings.vertical ? popupWidth : popupHeight,
      popupPadding,
    );
    if (footnoteRef.current) {
      const elem = document.createElement('p');
      elem.textContent = footnote;
      elem.setAttribute('style', `padding: 16px; hanging-punctuation: allow-end last;`);
      footnoteRef.current.replaceChildren(elem);
      setShowPopup(true);
      setTrianglePosition(triangPos);
      setPopupPosition(popupPos);
    }
  };

  useFoliateEvents(view, {
    onLinkClick: docLinkHandler,
  });

  useEffect(() => {
    eventDispatcher.on('footnote-popup', handleFootnotePopupEvent);
    return () => {
      eventDispatcher.off('footnote-popup', handleFootnotePopupEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (footnoteViewRef.current) {
      footnoteRef.current?.replaceChildren(footnoteViewRef.current);
    }
  }, [footnoteRef]);

  const width = viewSettings.vertical ? popupHeight : popupWidth;
  const height = viewSettings.vertical ? popupWidth : popupHeight;

  return (
    <div>
      {showPopup && (
        <div
          className='fixed inset-0'
          onClick={handleDismissPopup}
          onContextMenu={handleDismissPopup}
        />
      )}
      <Popup
        width={width}
        height={height}
        position={showPopup ? popupPosition! : undefined}
        trianglePosition={showPopup ? trianglePosition! : undefined}
        className='select-text overflow-y-auto'
      >
        <div
          className=''
          ref={footnoteRef}
          style={{
            width: `${width}px`,
            height: `${height}px`,
          }}
        ></div>
      </Popup>
    </div>
  );
};

export default FootnotePopup;
