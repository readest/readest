/**
 * Opening the library's menu starts loading Settings, once the menu has painted.
 *
 * Settings loads when it first opens (~1.5 MB of code); on an e-ink reader that load made its
 * first open ~1 s slower. The menu is the way there, so it starts the load as it opens, but only
 * after its own frame: on Readest Lite a script loads on the main thread, and a load started with
 * the menu held the menu's frame back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const loaded = vi.hoisted(() => ({ settings: false }));
vi.mock('@/components/settings/SettingsDialog', () => {
  loaded.settings = true;
  return { default: () => null };
});
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));
vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: undefined, quotas: [] }),
}));

const { default: SettingsMenu } = await import('@/app/library/components/SettingsMenu');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the library menu', () => {
  it('starts loading Settings after its first frame', async () => {
    let frame: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frame.push(cb));
    const runFrame = () => {
      const due = frame;
      frame = [];
      due.forEach((cb) => cb(performance.now()));
    };

    render(<SettingsMenu onPullLibrary={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loaded.settings).toBe(false);

    runFrame(); // the frame that paints the menu
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loaded.settings).toBe(false);

    runFrame();
    await waitFor(() => expect(loaded.settings).toBe(true));
  });
});
