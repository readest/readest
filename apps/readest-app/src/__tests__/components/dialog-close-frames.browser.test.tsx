/**
 * The dialog must never be painted without its body.
 *
 * Callers gate the body on the same flag they pass as `isOpen`, and Dialog
 * holds the last body for the length of the close transition. That handoff has
 * to land before the browser paints. A passive effect lands after it, so on a
 * non-discrete update (a close from a promise or a frame callback rather than
 * straight out of the click handler) the frame in between shows the box
 * collapsed onto its title bar.
 *
 * Needs real frames and the real stylesheet, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    systemUIVisible: false,
    statusBarHeight: 0,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));
vi.mock('@tauri-apps/plugin-haptics', () => ({ impactFeedback: vi.fn() }));

const { default: Dialog } = await import('@/components/Dialog');
await import('@/styles/globals.css');

type Sample = { visible: boolean; body: boolean; height: number };

const boxHeight = () => (document.querySelector('.modal-box') as HTMLElement).offsetHeight;

const sample = (): Sample => {
  const dialog = document.querySelector('dialog') as HTMLElement;
  const box = document.querySelector('.modal-box') as HTMLElement;
  return {
    visible:
      getComputedStyle(dialog).visibility === 'visible' &&
      Number(getComputedStyle(box).opacity) > 0,
    body: !!document.querySelector('[data-testid="dialog-body"]'),
    // Not the bounding rect: daisyUI scales the box down as it leaves.
    height: box.offsetHeight,
  };
};

// Rendered after the dialog, so its passive effect runs in the same flush as
// Dialog's own effects and sees every tree React commits on the way out. This
// is the deterministic half of the guarantee: a frame sampler alone cannot say
// whether the browser happened to paint a bad commit, but a bad commit that is
// never built cannot be painted either.
const CommitProbe = ({ onCommit }: { onCommit: (sample: Sample) => void }) => {
  useEffect(() => {
    onCommit(sample());
  });
  return null;
};

let setOpen: ((open: boolean) => void) | null = null;

// `sm:h-auto` is what the About dialog passes, so the box takes its height
// from the body and a missing body shows up as a collapse.
const Harness = ({ onCommit }: { onCommit: (sample: Sample) => void }) => {
  const [isOpen, setIsOpen] = useState(true);
  setOpen = setIsOpen;
  return (
    <>
      <Dialog
        isOpen={isOpen}
        title='About Readest'
        boxClassName='sm:h-auto'
        onClose={() => setIsOpen(false)}
      >
        {isOpen && <p data-testid='dialog-body'>Version 0.12.1</p>}
      </Dialog>
      <CommitProbe onCommit={onCommit} />
    </>
  );
};

const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// Close the dialog the way the app's own async paths do, outside React's act
// environment: act would flush the passive effects for us and hide the very
// ordering under test.
const closeOutsideAct = async (settle: () => Promise<void>) => {
  const wasActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    // A default-priority update, the kind React is free to let the browser
    // paint before it flushes passive effects.
    requestAnimationFrame(() => setOpen?.(false));
    await settle();
  } finally {
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
  }
};

const mount = async (onCommit: (sample: Sample) => void = () => {}) => {
  await page.viewport(1024, 768);
  render(<Harness onCommit={onCommit} />);
  await new Promise((resolve) => setTimeout(resolve, 400));
};

afterEach(() => {
  cleanup();
  setOpen = null;
});

describe('Dialog close frames', () => {
  it('leaves no commit with the box on screen and the body gone', async () => {
    const commits: Sample[] = [];
    await mount((commit) => commits.push(commit));
    const openHeight = boxHeight();
    expect(openHeight).toBeGreaterThan(0);

    commits.length = 0;
    await closeOutsideAct(() => new Promise((resolve) => setTimeout(resolve, 600)));

    expect(commits.length).toBeGreaterThan(0);
    const onScreen = commits.filter((commit) => commit.visible);
    expect(onScreen.length).toBeGreaterThan(0);
    expect(onScreen.filter((commit) => !commit.body)).toEqual([]);
    expect(onScreen.filter((commit) => commit.height !== openHeight)).toEqual([]);
  });

  it('never paints the box without its body', async () => {
    await mount();
    const openHeight = boxHeight();

    // Sample what each frame is about to paint: rAF callbacks run after layout
    // and before the paint, so this is the frame the user sees.
    const frames: Sample[] = [];
    await closeOutsideAct(async () => {
      const started = performance.now();
      while (performance.now() - started < 600) {
        await nextFrame();
        frames.push(sample());
      }
    });

    const onScreen = frames.filter((frame) => frame.visible);
    expect(onScreen.length).toBeGreaterThan(0);
    expect(onScreen.filter((frame) => !frame.body)).toEqual([]);
    expect(onScreen.filter((frame) => frame.height !== openHeight)).toEqual([]);
    // The hold is bounded: the body goes once the dialog is off screen.
    expect(frames[frames.length - 1]?.body).toBe(false);
  });
});
