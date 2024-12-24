import React, { useEffect, useRef, useState } from 'react';

import { BookDoc } from '@/libs/document';
import { useReaderStore } from '@/store/readerStore';
import { useFoliateEvents } from '../hooks/useFoliateEvents';
import { useTheme } from '@/hooks/useTheme';
import { getStyles } from '@/utils/style';
import { getPopupPosition, getPosition, Position } from '@/utils/sel';
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
      renderer.setStyles?.(getStyles(viewSettings, popupTheme));
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
    const popupPos = getPopupPosition(triangPos, rect, popupWidth, popupHeight, popupPadding);
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

  useFoliateEvents(view, {
    onLinkClick: docLinkHandler,
  });

  useEffect(() => {
    if (footnoteViewRef.current) {
      footnoteRef.current?.replaceChildren(footnoteViewRef.current);
    }
  }, [footnoteRef]);

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
        width={popupWidth}
        height={popupHeight}
        position={showPopup ? popupPosition! : undefined}
        trianglePosition={showPopup ? trianglePosition! : undefined}
        className='select-text overflow-y-auto'
      >
        <div
          className=''
          ref={footnoteRef}
          style={{
            width: `${popupWidth}px`,
            height: `${popupHeight}px`,
          }}
        ></div>
      </Popup>
    </div>
  );
};

export default FootnotePopup;
