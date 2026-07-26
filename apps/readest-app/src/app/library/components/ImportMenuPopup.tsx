import clsx from 'clsx';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { Overlay } from '@/components/Overlay';
import ImportMenu, { ImportMenuProps } from './ImportMenu';

const VIEWPORT_PADDING = 8;
const ANCHOR_GAP = 8;

interface Size {
  width: number;
  height: number;
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Anchor the menu below the button that opened it, flipping above when it would
 * run off the bottom and clamping to `bounds` near the edges. The bookshelf "+"
 * tile lives inside the virtualized scroller, so the menu is positioned as a
 * fixed overlay instead of a `dropdown-content` that the scroller would clip.
 */
export const getMenuPosition = (anchor: DOMRect, menu: Size, bounds: Bounds) => {
  const left = Math.max(
    bounds.left,
    Math.min(anchor.left + anchor.width / 2 - menu.width / 2, bounds.right - menu.width),
  );
  const below = anchor.bottom + ANCHOR_GAP;
  const fitsBelow = below + menu.height <= bounds.bottom;
  const top = fitsBelow ? below : Math.max(bounds.top, anchor.top - ANCHOR_GAP - menu.height);
  return { left, top };
};

interface ImportMenuPopupProps
  extends Omit<ImportMenuProps, 'menuClassName' | 'setIsDropdownOpen'> {
  anchor: HTMLElement;
  onClose: () => void;
}

const ImportMenuPopup: React.FC<ImportMenuPopupProps> = ({ anchor, onClose, ...menuProps }) => {
  const { safeAreaInsets: insets } = useThemeStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setPosition(
      getMenuPosition(
        anchor.getBoundingClientRect(),
        { width, height },
        {
          left: VIEWPORT_PADDING + (insets?.left ?? 0),
          top: VIEWPORT_PADDING + (insets?.top ?? 0),
          right: window.innerWidth - VIEWPORT_PADDING - (insets?.right ?? 0),
          bottom: window.innerHeight - VIEWPORT_PADDING - (insets?.bottom ?? 0),
        },
      ),
    );
  }, [anchor, insets]);

  return (
    <>
      <Overlay onDismiss={onClose} className='z-50' />
      <div
        ref={menuRef}
        className={clsx('fixed z-50 w-max', !position && 'invisible')}
        style={{ left: position?.left ?? 0, top: position?.top ?? 0 }}
      >
        <ImportMenu
          menuClassName='no-triangle !mt-0'
          setIsDropdownOpen={(open) => !open && onClose()}
          {...menuProps}
        />
      </div>
    </>
  );
};

export default ImportMenuPopup;
