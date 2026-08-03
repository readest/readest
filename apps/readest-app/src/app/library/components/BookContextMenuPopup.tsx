import clsx from 'clsx';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { Overlay } from '@/components/Overlay';
import ModalPortal from '@/components/ModalPortal';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

const VIEWPORT_PADDING = 8;

interface Point {
  x: number;
  y: number;
}

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
 * Place the menu with its top-left corner at the pointer, flipping to the
 * other side of the pointer when it would run off the right/bottom edge and
 * clamping to `bounds` as a last resort (matches native context menus).
 */
export const getContextMenuPosition = (point: Point, menu: Size, bounds: Bounds) => {
  const fitsRight = point.x + menu.width <= bounds.right;
  const left = Math.max(bounds.left, fitsRight ? point.x : point.x - menu.width);
  const fitsBelow = point.y + menu.height <= bounds.bottom;
  const top = Math.max(bounds.top, fitsBelow ? point.y : point.y - menu.height);
  return { left, top };
};

export interface BookContextMenuItem {
  text: string;
  action: () => void;
}

interface BookContextMenuPopupProps {
  position: Point;
  items: BookContextMenuItem[];
  onClose: () => void;
}

/**
 * In-app replacement for the native context menu on Linux desktop: GTK3 menus
 * popped over Wayland after the triggering button was already released (a
 * touchpad two-finger tap) are dismissed as soon as they map, so the menu
 * flashes and disappears (issue #5360). Rendered through ModalPortal because
 * the bookshelf item wrapper carries a scale transform, which would turn a
 * position:fixed popup inside it into an item-relative one.
 */
const BookContextMenuPopup: React.FC<BookContextMenuPopupProps> = ({
  position,
  items,
  onClose,
}) => {
  const { safeAreaInsets: insets } = useThemeStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    setPlacement(
      getContextMenuPosition(
        position,
        { width, height },
        {
          left: VIEWPORT_PADDING + (insets?.left ?? 0),
          top: VIEWPORT_PADDING + (insets?.top ?? 0),
          right: window.innerWidth - VIEWPORT_PADDING - (insets?.right ?? 0),
          bottom: window.innerHeight - VIEWPORT_PADDING - (insets?.bottom ?? 0),
        },
      ),
    );
    menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [position, insets]);

  return (
    <ModalPortal showOverlay={false}>
      <Overlay onDismiss={onClose} className='z-0' />
      <div
        ref={menuRef}
        className={clsx('absolute z-[1] w-max', !placement && 'invisible')}
        style={{ left: placement?.left ?? 0, top: placement?.top ?? 0 }}
      >
        <Menu
          className='dropdown-content no-triangle bg-base-100 rounded-box !relative z-[1] !mt-0 p-2 shadow'
          onCancel={onClose}
        >
          {items.map(({ text, action }) => (
            <MenuItem
              key={text}
              noIcon
              label={text}
              onClick={() => {
                onClose();
                action();
              }}
            />
          ))}
        </Menu>
      </div>
    </ModalPortal>
  );
};

export default BookContextMenuPopup;
