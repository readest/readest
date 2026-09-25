import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const globals = readFileSync(path.join(appRoot, 'src/styles/globals.css'), 'utf8');
const appLockScreen = readFileSync(path.join(appRoot, 'src/components/AppLockScreen.tsx'), 'utf8');
const providers = readFileSync(path.join(appRoot, 'src/components/Providers.tsx'), 'utf8');

const zIndexOf = (css: string, selector: string) => {
  const rule = css.match(new RegExp(`\\.${selector}\\s*\\{[^}]*z-index:\\s*(\\d+)`));
  return Number(rule?.[1]);
};

/**
 * The Windows 10 client-area frame stands in for the OS's non-client edge, which no
 * page content ever covered, so it has to out-layer every overlay — the app-lock
 * screen most of all, since it paints an opaque surface over the whole window while
 * the app shell underneath it is `display: none`.
 */
describe('window-outline stacking', () => {
  const outlineZ = zIndexOf(globals, 'window-outline');
  const lockZ = Number(appLockScreen.match(/z-\[(\d+)\]/)?.[1]);

  it('reads both layers out of the source it guards', () => {
    expect(Number.isFinite(outlineZ)).toBe(true);
    expect(Number.isFinite(lockZ)).toBe(true);
  });

  it('draws the frame above the app-lock screen', () => {
    expect(outlineZ).toBeGreaterThan(lockZ);
  });

  it('mounts the frame outside the gated app shell', () => {
    expect(providers).toMatch(/style=\{appShellHidden \? \{ display: 'none' \}/);
    expect(providers.indexOf('<WindowOutline />')).toBeGreaterThan(
      providers.indexOf('{showAppLockScreen && <AppLockScreen />}'),
    );
  });
});
