import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Coordinated overlay z-index scale.
 *
 * Body-portaled / full-screen overlays share a single global stacking order.
 * They must all clear the desktop rounded-window page frame (`.window-border`,
 * z-index 99 in globals.css) and then layer in this order (low -> high):
 *
 *   100  RSVP immersive reading overlay
 *   101  RSVP immersive controls (start dialog / hint chip)
 *   110  Settings app dialog (raised above RSVP for dictionary management)
 *   120  modal / command-palette layer (ModalPortal, CommandPalette)
 *   130  toast / alert
 *   200  security lock screen (AppLockScreen)
 *
 * This test reads the values straight from source so a future change that
 * re-orders the layers fails loudly. It encodes the regression that buried the
 * "Add OPDS Catalog" dialog behind Settings on mobile: Settings had been raised
 * to z-[10050] (PR #3235) above the ModalPortal at z-[100], so any modal opened
 * from inside Settings rendered behind it.
 */

const PAGE_FRAME = 99; // .window-border in src/styles/globals.css

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const firstZ = (src: string, re: RegExp): number => {
  const m = src.match(re);
  expect(m, `expected to find z-index via ${re} in source`).not.toBeNull();
  return Number(m![1]);
};

const MODAL = firstZ(read('src/components/ModalPortal.tsx'), /z-\[(\d+)\]/);
const SETTINGS = firstZ(read('src/components/settings/SettingsDialog.tsx'), /!z-\[(\d+)\]/);
const RSVP_OVERLAY = firstZ(
  read('src/app/reader/components/rsvp/RSVPOverlay.tsx'),
  /fixed inset-0 z-\[(\d+)\] flex select-none/,
);
const RSVP_CONTROLS = firstZ(
  read('src/app/reader/components/rsvp/RSVPStartDialog.tsx'),
  /z-\[(\d+)\]/,
);
const TOAST = firstZ(read('src/components/Toast.tsx'), /toast z-\[(\d+)\]/);
const APP_LOCK = firstZ(read('src/components/AppLockScreen.tsx'), /z-\[(\d+)\]/);

describe('overlay z-index scale', () => {
  it('renders a modal (e.g. Add OPDS Catalog) above the Settings dialog', () => {
    // Regression: ModalPortal opened from inside Settings was buried (#add-catalog).
    expect(MODAL).toBeGreaterThan(SETTINGS);
  });

  it('raises the Settings dialog above the RSVP immersive overlay', () => {
    expect(SETTINGS).toBeGreaterThan(RSVP_OVERLAY);
  });

  it('keeps RSVP controls above the RSVP overlay', () => {
    expect(RSVP_CONTROLS).toBeGreaterThan(RSVP_OVERLAY);
  });

  it('keeps the RSVP overlay above the desktop window-border page frame', () => {
    expect(RSVP_OVERLAY).toBeGreaterThan(PAGE_FRAME);
  });

  it('raises toasts above every modal so they show over open dialogs', () => {
    // Regression: a sync-complete toast dispatched from the open Settings
    // dialog was buried because the toast sat at z-50, below Settings (110)
    // and ModalPortal (120).
    expect(TOAST).toBeGreaterThan(MODAL);
    expect(TOAST).toBeGreaterThan(SETTINGS);
  });

  it('keeps the security lock screen on top of every modal and toast', () => {
    expect(APP_LOCK).toBeGreaterThan(MODAL);
    expect(APP_LOCK).toBeGreaterThan(TOAST);
  });

  it('uses a compact scale with no four-digit z-index', () => {
    for (const value of [RSVP_OVERLAY, RSVP_CONTROLS, SETTINGS, MODAL, TOAST, APP_LOCK]) {
      expect(value).toBeLessThan(1000);
    }
  });
});
