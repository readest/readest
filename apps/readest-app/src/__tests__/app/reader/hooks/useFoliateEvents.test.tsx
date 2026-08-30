import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';
import type { FoliateView } from '@/types/view';

describe('useFoliateEvents', () => {
  it('subscribes to fixed-layout overlayer rebuilds on the renderer', () => {
    const renderer = document.createElement('div');
    const view = document.createElement('div') as unknown as FoliateView;
    Object.defineProperty(view, 'renderer', { value: renderer });
    const onRendererCreateOverlayer = vi.fn();
    const { unmount } = renderHook(() => useFoliateEvents(view, { onRendererCreateOverlayer }));
    const event = new CustomEvent('create-overlayer', {
      detail: { doc: document, index: 3 },
    });

    renderer.dispatchEvent(event);

    expect(onRendererCreateOverlayer).toHaveBeenCalledWith(event);
    unmount();
    renderer.dispatchEvent(event);
    expect(onRendererCreateOverlayer).toHaveBeenCalledTimes(1);
  });
});
