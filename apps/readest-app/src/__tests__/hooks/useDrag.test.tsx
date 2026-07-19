import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { useDrag } from '@/hooks/useDrag';

type Api = ReturnType<typeof useDrag>;

const setup = (onMove = vi.fn(), onEnd = vi.fn()) => {
  let api: Api = null as unknown as Api;
  function Wrapper() {
    api = useDrag(onMove, vi.fn(), onEnd);
    return null;
  }
  render(<Wrapper />);
  return { getApi: () => api, onMove, onEnd };
};

const startMouseDrag = (api: Api, clientX = 100) => {
  act(() => {
    api.handleDragStart({ clientX, clientY: 0 } as unknown as ReactMouseEvent);
  });
};

const fireWindowMouse = (type: string, clientX: number, clientY = 0) => {
  act(() => {
    window.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
  });
};

const getShield = () => document.querySelector<HTMLElement>('.drag-shield');

describe('useDrag', () => {
  afterEach(() => {
    cleanup();
    document.body.style.cssText = '';
    document.documentElement.style.cssText = '';
  });

  it('keeps a top-most pointer-capturing shield above the content while dragging so a release over a PDF iframe still ends the drag (readest#5043)', () => {
    const { getApi } = setup();
    expect(getShield()).toBeNull();

    startMouseDrag(getApi());

    const shield = getShield();
    expect(shield).not.toBeNull();
    // Must sit above the book iframes (sidebar is z-[45]) and stay interactive
    // even though PDF pages set inline pointer-events:auto on their iframes.
    expect(shield!.style.position).toBe('fixed');
    expect(shield!.style.pointerEvents).toBe('auto');
    expect(Number(shield!.style.zIndex)).toBeGreaterThan(45);
  });

  it('removes the shield and stops resizing once the pointer is released', () => {
    const { getApi, onMove, onEnd } = setup();
    startMouseDrag(getApi());

    fireWindowMouse('mousemove', 150);
    expect(onMove).toHaveBeenCalledTimes(1);

    fireWindowMouse('mouseup', 150);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(getShield()).toBeNull();

    // No further resizing after release.
    fireWindowMouse('mousemove', 200);
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
