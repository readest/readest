import { useLayoutEffect, useRef, useState } from 'react';

type PlayerSize = { w: number; h: number };

const STORAGE_KEY = 'ttsPlayerSize';
const MIN_WIDTH = 360;
const MIN_HEIGHT = 320;

const readStoredSize = (): PlayerSize | null => {
  try {
    const size = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return typeof size?.w === 'number' && typeof size?.h === 'number' ? size : null;
  } catch {
    return null;
  }
};

const clampSize = ({ w, h }: PlayerSize): PlayerSize => ({
  w: Math.round(Math.min(Math.max(w, MIN_WIDTH), window.innerWidth)),
  h: Math.round(Math.min(Math.max(h, MIN_HEIGHT), window.innerHeight)),
});

// The size rides on CSS variables the dialog box's classes read, so a drag
// restyles the box directly instead of re-rendering the whole sheet per move.
const applySize = (box: HTMLElement | null | undefined, size: PlayerSize | null) => {
  if (!box) return;
  if (size) {
    box.style.setProperty('--tts-player-w', `${size.w}px`);
    box.style.setProperty('--tts-player-h', `${size.h}px`);
  } else {
    box.style.removeProperty('--tts-player-w');
    box.style.removeProperty('--tts-player-h');
  }
};

// Pointer resizing for the full Read Aloud player on desktop: a corner grip
// sizes the dialog box, and the size is kept for the next time it opens.
export const usePlayerResize = () => {
  const gripRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PlayerSize | null>(readStoredSize);
  const dragRef = useRef<{ x: number; y: number; w: number; h: number; rtl: boolean } | null>(null);
  const lastRef = useRef<PlayerSize | null>(null);

  const box = () => gripRef.current?.closest<HTMLElement>('.modal-box');

  // The box mounts with the sheet: re-apply on every render that may bring it.
  useLayoutEffect(() => {
    applySize(box(), size);
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = box();
    if (e.button !== 0 || !el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: rect.width,
      h: rect.height,
      rtl: getComputedStyle(el).direction === 'rtl',
    };
    lastRef.current = null;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // The box is centered, so it grows on both sides: twice the pointer's
    // travel keeps the corner under the pointer.
    const dx = (e.clientX - drag.x) * (drag.rtl ? -1 : 1);
    const next = clampSize({ w: drag.w + 2 * dx, h: drag.h + 2 * (e.clientY - drag.y) });
    lastRef.current = next;
    applySize(box(), next);
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    const next = lastRef.current;
    if (!next) return;
    setSize(next);
    // Best-effort, like the read: blocked storage keeps the size for this session.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };

  return {
    sized: !!size,
    gripProps: {
      ref: gripRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
};
