import { describe, it, expect, vi } from 'vitest';
import {
  NativePageTurn,
  type NativePaperCommand,
  type NativePaperResult,
} from '@/app/reader/utils/nativePageTurn';
import type { CapturedTurnHost } from '@/app/reader/utils/capturedTurn';
import type { Renderer } from '@/types/view';

const fixture = (columns?: number) => {
  let page = 1;
  const events: string[] = [];
  const renderer = {
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getPageTurnKey: (delta = 0) => String(page + delta),
    previewPage: async <T>(forward: boolean, read: () => Promise<T>) => {
      const original = page;
      page += forward ? 1 : -1;
      try {
        return { key: String(page), value: await read() };
      } finally {
        page = original;
      }
    },
  } as unknown as Renderer;
  const capture = vi.fn<CapturedTurnHost['capture']>(async () => {
    throw new Error('JPEG path must not run');
  });
  const navigate = vi.fn(async (forward: boolean) => {
    events.push('navigate');
    page += forward ? 1 : -1;
  });
  const call = vi.fn(async (args: NativePaperCommand): Promise<NativePaperResult> => {
    events.push(args.op);
    return { touchTracked: true };
  });
  const controller = new NativePageTurn(
    {
      getHostElement: () => document.body,
      getContentRect: () => new DOMRect(0, 0, 360, 780),
      ...(columns ? { getColumnCount: () => columns } : {}),
      capture,
      navigate,
    },
    { renderer, enabled: () => true, call },
  );
  return { controller, call, capture, navigate, events, renderer };
};

describe('Android native page-turn pipeline', () => {
  // The native scene outlives a page reload (WebContent crash, reopen). A
  // reloaded reader must not reuse the previous page's owner, or the native
  // side keeps that page's generation and rejects every capture.
  it('gives a reader on a reloaded page a new native owner', async () => {
    const owners = new Set<number>();
    for (let load = 0; load < 2; load++) {
      vi.resetModules();
      const { NativePageTurn: Fresh } = await import('@/app/reader/utils/nativePageTurn');
      const call = vi.fn(async (_args: NativePaperCommand): Promise<NativePaperResult> => ({}));
      const controller = new Fresh(
        {
          getHostElement: () => document.body,
          getContentRect: () => new DOMRect(0, 0, 360, 780),
          capture: vi.fn(),
          navigate: vi.fn(),
        },
        { renderer: fixture().renderer, enabled: () => true, call },
      );
      controller.dispose();
      owners.add(call.mock.calls[0]![0].owner);
    }
    expect(owners.size).toBe(2);
  });

  it('tells the native scene how many columns the spread shows', async () => {
    for (const columns of [1, 2]) {
      const f = fixture(columns);
      try {
        expect(await f.controller.turn(true, false)).toBe(true);
        expect(f.call.mock.calls.find(([args]) => args.op === 'start')?.[0]).toMatchObject({
          columns,
        });
      } finally {
        f.controller.dispose();
      }
    }
  });

  it('turns a renderer without page previews by navigating under the cover', async () => {
    const f = fixture();
    delete (f.renderer as { previewPage?: unknown }).previewPage;
    try {
      await f.controller.prepareCapture('curl');
      expect(await f.controller.turn(true, false)).toBe(true);
      expect(f.events.indexOf('cover')).toBeLessThan(f.events.indexOf('navigate'));
      expect(f.call.mock.calls.find(([args]) => args.op === 'start')?.[0]).toMatchObject({
        key: '1',
        destination: '2',
      });
      // The page left behind stays resident, so turning back starts at once.
      f.events.length = 0;
      expect(await f.controller.turn(false, false)).toBe(true);
      expect(f.events[0]).toBe('start');
      expect(f.capture).not.toHaveBeenCalled();
    } finally {
      f.controller.dispose();
    }
  });

  it('does not roll a cancelled boundary clamp forwards and keeps the next turn usable', async () => {
    const f = fixture();
    const key = f.renderer.getPageTurnKey!;
    const navigate = f.navigate.getMockImplementation()!;
    f.renderer.getPageTurnKey = (delta = 0) => (delta < 0 ? null : key(delta));
    f.navigate.mockImplementation(async (forward) => {
      if (forward) await navigate(forward);
    });
    try {
      const beginning = f.controller.beginDrag(false, false);
      const ending = f.controller.endDrag(false);
      expect(await beginning).toBe(false);
      await ending;
      expect(f.navigate.mock.calls).toEqual([[false]]);
      expect(await f.controller.turn(true, false)).toBe(true);
      expect(f.renderer.getPageTurnKey?.()).toBe('2');
    } finally {
      f.controller.dispose();
    }
  });

  it('does not create a previous sheet when the reader clamps navigation at the first page', async () => {
    const f = fixture();
    const key = f.renderer.getPageTurnKey!;
    const navigate = f.navigate.getMockImplementation()!;
    f.renderer.getPageTurnKey = (delta = 0) => (delta < 0 ? null : key(delta));
    f.navigate.mockImplementation(async (forward) => {
      if (forward) await navigate(forward);
    });
    try {
      expect(await f.controller.turn(false, false)).toBe(false);
      expect(f.call.mock.calls.filter(([args]) => args.op === 'start')).toHaveLength(0);
      expect(await f.controller.turn(true, false)).toBe(true);
      expect(
        f.call.mock.calls.filter(([args]) => args.op === 'start').map(([args]) => args.key),
      ).toEqual(['1']);
      expect(f.navigate.mock.calls).toEqual([[false], [true]]);
    } finally {
      f.controller.dispose();
    }
  });

  it('rechecks the book boundary when a queued tap reaches the reader', async () => {
    const f = fixture();
    const key = f.renderer.getPageTurnKey!;
    Object.defineProperty(f.renderer, 'atEnd', { get: () => key() === '2' });
    try {
      const results = await Promise.all([
        f.controller.turn(true, false),
        f.controller.turn(true, false),
        f.controller.turn(true, false),
      ]);
      expect(results).toEqual([true, false, false]);
      expect(f.navigate.mock.calls).toEqual([[true]]);
    } finally {
      f.controller.dispose();
    }
  });

  it('animates every tap in a burst without dropping turns during preparation', async () => {
    const f = fixture();
    try {
      await f.controller.prepareCapture('curl');
      const results = await Promise.all([
        f.controller.turn(true, false),
        f.controller.turn(true, false),
        f.controller.turn(false, false),
      ]);
      expect(results).toEqual([true, true, true]);
      expect(f.navigate.mock.calls).toEqual([[true], [true], [false]]);
      expect(f.call.mock.calls.filter(([args]) => args.op === 'animate')).toHaveLength(3);
      expect(
        f.call.mock.calls.filter(([args]) => args.op === 'start').map(([args]) => args.key),
      ).toEqual(['1', '2', '3']);
      const starts = f.call.mock.calls
        .filter(([args]) => args.op === 'start')
        .map(([args]) => args.turnId);
      const completed = f.call.mock.calls
        .filter(([args]) => args.op === 'complete')
        .map(([args]) => args.turnId);
      expect(completed).toEqual(starts.slice(0, 2));
    } finally {
      f.controller.dispose();
    }
  });

  it('marks a swipe released before start separately from missing native touch tracking', async () => {
    const f = fixture();
    try {
      await f.controller.prepareCapture('curl');
      const begun = f.controller.beginDrag(true, false);
      f.controller.moveDrag(1, 0.5);
      const ended = f.controller.endDrag(true);
      await begun;
      await ended;
      expect(f.call.mock.calls.find(([args]) => args.op === 'start')?.[0]).toMatchObject({
        released: true,
      });
    } finally {
      f.controller.dispose();
    }
  });
  it('keeps commands tied to their own turn when the next swipe interrupts a settling sheet', async () => {
    const f = fixture();
    let complete!: (result: NativePaperResult) => void;
    let settling = false;
    try {
      await f.controller.prepareCapture('curl');
      await f.controller.beginDrag(true, false);
      f.call.mockImplementation(async (args) => {
        if (args.op === 'animate' && !settling) {
          settling = true;
          return new Promise<NativePaperResult>((resolve) => {
            complete = resolve;
          });
        }
        if (args.op === 'complete') complete({});
        return {};
      });
      const first = f.controller.endDrag(true);
      await vi.waitFor(() => expect(settling).toBe(true));
      expect(await f.controller.beginDrag(false, false)).toBe(true);
      await first;
      await f.controller.endDrag(true);
      const commands = f.call.mock.calls.map(([args]) => args);
      const turns = commands.filter((args) => args.op === 'start').map((args) => args.turnId);
      expect(turns).toHaveLength(2);
      expect(turns[0]).not.toBe(turns[1]);
      expect(commands.find((args) => args.op === 'complete')?.turnId).toBe(turns[0]);
      expect(commands.filter((args) => args.op === 'finish').map((args) => args.turnId)).toEqual(
        turns,
      );
      expect(f.navigate.mock.calls).toEqual([[true], [false]]);
    } finally {
      f.controller.dispose();
    }
  });
  it('retries a programmatic turn after a failed start', async () => {
    const f = fixture();
    try {
      await f.controller.prepareCapture('curl');
      f.call.mockRejectedValueOnce(new Error('interrupted native frame'));
      await expect(f.controller.turn(true, false)).rejects.toThrow('interrupted native frame');
      expect(await f.controller.turn(true, false)).toBe(true);
      expect(f.navigate).toHaveBeenCalledExactlyOnceWith(true);
    } finally {
      f.controller.dispose();
    }
  });
  it('does not roll a cancelled cold section back twice when final presentation fails', async () => {
    const f = fixture();
    const key = f.renderer.getPageTurnKey!;
    f.renderer.getPageTurnKey = (delta = 0) => (delta ? null : key(0));
    try {
      await f.controller.beginDrag(true, false, 'curl');
      f.call.mockImplementation(async ({ op }) => {
        if (op === 'finish') throw new Error('presentation failed');
        return { touchTracked: true };
      });
      await expect(f.controller.endDrag(false)).rejects.toThrow('presentation failed');
      expect(f.navigate.mock.calls).toEqual([[true], [false]]);
      expect(f.controller.active).toBe(false);
    } finally {
      f.controller.dispose();
    }
  });
  it('releases a failed native scene and permits the next gesture', async () => {
    const f = fixture();
    try {
      await f.controller.prepareCapture('curl');
      f.call.mockImplementationOnce(async () => {
        throw new Error('native frame failed');
      });
      await expect(f.controller.beginDrag(true, false, 'curl')).rejects.toThrow(
        'native frame failed',
      );
      expect(f.controller.active).toBe(false);
      expect(f.navigate).not.toHaveBeenCalled();
      expect(await f.controller.beginDrag(true, false, 'curl')).toBe(true);
      await f.controller.endDrag(true);
      expect(f.navigate).toHaveBeenCalledExactlyOnceWith(true);
      expect(f.renderer.removeAttribute).toHaveBeenCalledWith('data-native-paper-commit');
    } finally {
      f.controller.dispose();
    }
  });

  it('restores a cold section when the gesture is cancelled', async () => {
    const f = fixture();
    const key = f.renderer.getPageTurnKey!;
    f.renderer.getPageTurnKey = (delta = 0) => (delta ? null : key(0));
    try {
      expect(await f.controller.beginDrag(true, false, 'curl')).toBe(true);
      expect(f.navigate).toHaveBeenNthCalledWith(1, true);
      await f.controller.endDrag(false);
      expect(f.navigate).toHaveBeenNthCalledWith(2, false);
      expect(f.controller.active).toBe(false);
      expect(f.events.at(-1)).toBe('finish');
      expect(f.capture).not.toHaveBeenCalled();
    } finally {
      f.controller.dispose();
    }
  });
  it('keeps page pixels native and commits only after native animation finishes', async () => {
    const f = fixture();
    try {
      expect(await f.controller.prepareCapture('curl')).toBe(true);
      const preparedCalls = f.call.mock.calls.length;
      expect(await f.controller.beginDrag(true, false, 'curl')).toBe(true);
      expect(f.call.mock.calls.slice(preparedCalls).map(([args]) => args.op)).not.toContain(
        'cover',
      );
      f.controller.moveDrag(0.4, 0.6);
      expect(f.navigate).not.toHaveBeenCalled();
      await f.controller.endDrag(true);
      expect(f.capture).not.toHaveBeenCalled();
      expect(f.navigate).toHaveBeenCalledExactlyOnceWith(true);
      expect(f.events.indexOf('animate')).toBeLessThan(f.events.indexOf('navigate'));
      expect(f.events.indexOf('navigate')).toBeLessThan(f.events.lastIndexOf('finish'));
    } finally {
      f.controller.dispose();
    }
  });

  it('cancels a resident sheet without navigating or transferring a screenshot', async () => {
    const f = fixture();
    try {
      await f.controller.prepareCapture('curl');
      await f.controller.beginDrag(false, false, 'curl');
      f.controller.moveDrag(0.3, 0.5);
      await f.controller.endDrag(false);
      expect(f.navigate).not.toHaveBeenCalled();
      expect(f.capture).not.toHaveBeenCalled();
      expect(f.events.at(-1)).toBe('finish');
    } finally {
      f.controller.dispose();
    }
  });
});
