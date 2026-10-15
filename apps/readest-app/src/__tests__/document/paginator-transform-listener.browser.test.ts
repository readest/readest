import { describe, it, expect } from 'vitest';
import type { Renderer } from '@/types/view';

// #6710: the reader keeps a book document cached after it closes, so a
// listener the paginator leaves on its transformTarget keeps the destroyed
// paginator, its iframes and their listeners alive, one more per open.
describe('paginator transformTarget listener', () => {
  it('is removed when the paginator is destroyed', async () => {
    await import('foliate-js/paginator.js');
    const transformTarget = new EventTarget();
    const live = new Set<EventListenerOrEventListenerObject>();
    const add = transformTarget.addEventListener.bind(transformTarget);
    const remove = transformTarget.removeEventListener.bind(transformTarget);
    transformTarget.addEventListener = (type, listener, options) => {
      if (listener) live.add(listener);
      add(type, listener, options);
    };
    transformTarget.removeEventListener = (type, listener, options) => {
      if (listener) live.delete(listener);
      remove(type, listener, options);
    };

    const paginator = document.createElement('foliate-paginator') as Renderer & {
      open: (book: unknown) => void;
      destroy: () => void;
    };
    document.body.append(paginator);
    paginator.open({ sections: [], transformTarget });
    expect(live.size).toBe(1);

    paginator.destroy();
    paginator.remove();
    expect(live.size).toBe(0);
  });
});
