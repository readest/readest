// readest/readest#7732: `view.goTo(target, { focus: true })` must still reach
// the renderer when the book resolves a target asynchronously, as KF8 (AZW3)
// `resolveHref` does.
import { describe, it, expect, beforeAll, vi } from 'vitest';

type RendererStub = { goTo: ReturnType<typeof vi.fn> };
type ViewUnderTest = HTMLElement & {
  renderer: RendererStub;
  resolveNavigation: (target: unknown) => unknown;
  goTo: (target: string, options?: { focus?: boolean }) => Promise<unknown>;
  history: { pushState: (state: unknown) => void; back: () => void };
};

const target = { index: 3, anchor: () => null };

const createView = () => {
  const view = document.createElement('foliate-view') as ViewUnderTest;
  view.renderer = { goTo: vi.fn(async () => {}) };
  view.resolveNavigation = () => Promise.resolve(target);
  return view;
};

describe('view.goTo with an asynchronously resolved target', () => {
  beforeAll(async () => {
    await import('foliate-js/view.js');
  });

  it('passes the resolved target and focus to the renderer', async () => {
    const view = createView();
    await view.goTo('kindle:pos:fid:0003:off:0000000000', { focus: true });
    expect(view.renderer.goTo).toHaveBeenCalledWith({ ...target, focus: true });
  });

  it('goes back through history to the resolved target', async () => {
    const view = createView();
    view.history.pushState('a');
    view.history.pushState('b');
    view.history.back();
    await vi.waitFor(() =>
      expect(view.renderer.goTo).toHaveBeenCalledWith({ ...target, focus: true }),
    );
  });
});
