/**
 * The profile header is a transparent, full-width `fixed` strip. Content
 * scrolls visibly beneath it, so its empty middle must not absorb clicks —
 * anything scrolled into that band (the billing interval toggle, most
 * visibly) would otherwise be unclickable.
 *
 * Needs real layout and real Tailwind, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/trafficLightStore', () => ({
  useTrafficLightStore: () => ({ isTrafficLightVisible: false }),
}));

const appService = { hasWindowBar: false, hasTrafficLight: false };
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService }) }));

const { default: ProfileHeader } = await import('@/app/user/components/Header');
await import('@/styles/globals.css');

const renderHeaderOverContent = () =>
  render(
    <div className='relative h-screen w-full'>
      <ProfileHeader onGoBack={() => {}} />
      <button data-testid='beneath' className='absolute left-1/2 top-4 h-8 w-40 -translate-x-1/2'>
        beneath
      </button>
    </div>,
  );

afterEach(() => cleanup());
beforeAll(async () => {
  await page.viewport(1280, 1024);
});

describe('profile header click-through', () => {
  it('lets a click in its empty middle reach the content beneath', () => {
    renderHeaderOverContent();

    const beneath = document.querySelector('[data-testid=beneath]') as HTMLElement;
    const r = beneath.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.round(r.left + r.width / 2),
      Math.round(r.top + r.height / 2),
    );

    expect(beneath.contains(hit)).toBe(true);
  });

  it('keeps its own back button clickable', () => {
    renderHeaderOverContent();

    const back = document.querySelector('button[aria-label="Go Back"]') as HTMLElement;
    const r = back.getBoundingClientRect();
    const hit = document.elementFromPoint(
      Math.round(r.left + r.width / 2),
      Math.round(r.top + r.height / 2),
    );

    expect(back.contains(hit)).toBe(true);
  });
});
