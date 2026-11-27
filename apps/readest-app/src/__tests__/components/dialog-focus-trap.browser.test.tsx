/**
 * Tab stays inside an open Dialog (#8007). Dialog renders `<dialog open>`
 * without `showModal()`, so nothing makes the page behind it inert: Tab used
 * to walk out to the reader's footer, and Enter then turned the book's page
 * behind the still-open dialog. Native Tab order only exists in a real
 * browser, hence a browser test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
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

const tab = (shift: boolean) => userEvent.keyboard(shift ? '{Shift>}{Tab}{/Shift}' : '{Tab}');

/** Press Tab `count` times, recording where focus lands after each press. */
async function walk(count: number, shift = false): Promise<Element[]> {
  const visited: Element[] = [];
  for (let i = 0; i < count; i++) {
    await tab(shift);
    visited.push(document.activeElement ?? document.body);
  }
  return visited;
}

// Dialog focuses itself 100 ms after opening unless focus is already inside;
// let that pass so it can't move the focus a test sets.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

const inside = (dialogName: string) => (el: Element) =>
  !!el.closest(`dialog[aria-label="${dialogName}"]`);

// Everything that took focus outside every open dialog, even for a moment:
// focusing the page behind can scroll it or reveal its controls.
let strays: string[] = [];
const recordStray = (event: FocusEvent) => {
  const target = event.target as Element;
  if (!target.closest?.('dialog[open]')) strays.push(target.textContent || target.ariaLabel || '');
};

// Wide: the header shows its × and hides the back arrow. Narrow: the sheet
// shows the back arrow and hides the ×. Either hidden button sits among the
// dialog's own controls, where Tab must not try to land.
for (const [width, height] of [
  [1024, 768],
  [400, 800],
] as const) {
  describe(`Dialog keeps Tab inside at ${width}x${height}`, () => {
    beforeEach(async () => {
      await page.viewport(width, height);
      strays = [];
      document.addEventListener('focusin', recordStray);
    });

    afterEach(() => {
      document.removeEventListener('focusin', recordStray);
      cleanup();
    });

    for (const shift of [false, true]) {
      it(`cycles through the dialog's own controls (${shift ? 'Shift+Tab' : 'Tab'})`, async () => {
        render(
          <>
            <button type='button'>Before</button>
            <Dialog isOpen title='Choose' onClose={vi.fn()}>
              <button type='button'>One</button>
              <button type='button'>Two</button>
            </Dialog>
            <button type='button'>After</button>
          </>,
        );
        await settle();
        screen.getByRole('button', { name: shift ? 'One' : 'Two' }).focus();

        const visited = await walk(8, shift);

        expect(strays).toEqual([]);
        expect(visited.every(inside('Choose'))).toBe(true);
        // It wraps rather than sticking: both controls come round again.
        expect(visited.map((el) => el.textContent)).toEqual(expect.arrayContaining(['One', 'Two']));
      });
    }

    it('stays inside a dialog whose body has nothing to focus (the #8007 QR code)', async () => {
      render(
        <>
          <Dialog isOpen title='Share as QR Code' onClose={vi.fn()}>
            <img alt='QR code' src='data:image/gif;base64,R0lGODlhAQABAAAAACw=' />
          </Dialog>
          <button type='button'>Previous Page</button>
        </>,
      );
      await settle();
      screen.getByRole('button', { name: 'Close' }).focus();

      for (const shift of [false, true]) {
        const visited = await walk(6, shift);
        expect(visited.every(inside('Share as QR Code'))).toBe(true);
      }
      expect(strays).toEqual([]);
    });

    it('leaves a radio group for the start of the dialog, not the page', async () => {
      render(
        <>
          <Dialog isOpen title='Pick' onClose={vi.fn()}>
            <input type='radio' name='size' aria-label='Small' defaultChecked />
            <input type='radio' name='size' aria-label='Large' />
          </Dialog>
          <button type='button'>After</button>
        </>,
      );
      await settle();
      screen.getByRole('radio', { name: 'Small' }).focus();

      await tab(false);

      expect(strays).toEqual([]);
      expect(inside('Pick')(document.activeElement!)).toBe(true);
    });

    it('wraps Shift+Tab past a visibility-hidden control at the end', async () => {
      // A `visibility: hidden` control keeps its layout box but can't take
      // focus: wrapping onto it would leave focus where it was.
      render(
        <Dialog isOpen title='Edit' onClose={vi.fn()}>
          <button type='button'>One</button>
          <button type='button'>Two</button>
          <button type='button' style={{ visibility: 'hidden' }}>
            Hidden last
          </button>
        </Dialog>,
      );
      await settle();
      // The header's visible close button is the first stop.
      screen.getByRole('button', { name: 'Close' }).focus();

      await tab(true);

      expect(document.activeElement?.textContent).toBe('Two');
    });

    it('brings back a Tab the browser still sends outside', async () => {
      // The inert button looks like a Tab stop ahead, but the browser skips it,
      // as macOS WebKit skips buttons by default: the Tab lands on the field behind.
      render(
        <>
          <Dialog isOpen title='Name' onClose={vi.fn()}>
            <input aria-label='Title' />
            <div inert>
              <button type='button'>Skipped</button>
            </div>
          </Dialog>
          <input aria-label='Search behind' />
        </>,
      );
      await settle();
      screen.getByRole('textbox', { name: 'Title' }).focus();

      await tab(false);

      expect(inside('Name')(document.activeElement!)).toBe(true);
    });

    it('keeps Tab inside the nested dialog while one is open', async () => {
      render(
        <Dialog isOpen title='Outer' onClose={vi.fn()}>
          <button type='button'>Outer action</button>
          <Dialog isOpen title='Inner' onClose={vi.fn()}>
            <button type='button'>Inner action</button>
          </Dialog>
        </Dialog>,
      );
      await settle();
      screen.getByRole('button', { name: 'Inner action' }).focus();

      const visited = await walk(6);

      expect(visited.every(inside('Inner'))).toBe(true);
    });

    it('sends Tab into a layer that covers the dialog, such as Add OPDS Catalog', async () => {
      // The layer opens from a button inside the dialog and doesn't take focus
      // itself, so focus is still on that button behind it.
      render(
        <>
          <Dialog isOpen title='Catalogs' onClose={vi.fn()}>
            <button type='button'>Add Catalog</button>
            <button type='button'>Browse</button>
          </Dialog>
          <div data-capture-blocking-overlay='true' className='fixed inset-0 z-[1200]'>
            <input aria-label='Catalog Name' />
            <button type='button'>Cancel</button>
          </div>
        </>,
      );
      await settle();
      screen.getByRole('button', { name: 'Add Catalog' }).focus();

      await tab(false);
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Catalog Name' }));

      // Back from the layer's start goes round inside the layer, not behind it.
      screen.getByRole('button', { name: 'Browse' }).focus();
      await tab(true);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });

    it('keeps Tab in the dialog over a layer beneath it, such as the selection popup', async () => {
      render(
        <>
          <div data-capture-blocking-overlay='true' className='fixed inset-0 z-0'>
            <button type='button'>Popup action</button>
          </div>
          <Dialog isOpen title='Share as QR Code' onClose={vi.fn()}>
            <button type='button'>Done</button>
          </Dialog>
        </>,
      );
      await settle();
      screen.getByRole('button', { name: 'Done' }).focus();

      const visited = await walk(4);

      expect(visited.every(inside('Share as QR Code'))).toBe(true);
    });

    it('leaves focus alone in a layer above the dialog, such as a ModalPortal', async () => {
      render(
        <>
          <Dialog isOpen title='Settings' onClose={vi.fn()}>
            <button type='button'>Setting</button>
          </Dialog>
          <div data-capture-blocking-overlay='true'>
            <button type='button'>Layer one</button>
            <button type='button'>Layer two</button>
          </div>
        </>,
      );
      await settle();
      screen.getByRole('button', { name: 'Layer one' }).focus();

      await tab(false);

      expect(document.activeElement?.textContent).toBe('Layer two');
    });
  });
}
