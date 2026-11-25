/**
 * The player sheet's transport row (pause-after-sentence, four arrows, play,
 * A-B) must fit the sheet it sits in. A 360 px portrait phone, and the desktop
 * card dragged to its 360 px minimum, leave the row 328 px; the row used to
 * need about 354 px there, so it overhung the sheet, wrapped the A-B label and
 * let the sheet scroll sideways (#7903). Where it already fit (the 420 px card)
 * the spacing stays as it was.
 *
 * Needs real layout and the real stylesheet, so it runs as a browser test.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// useResponsiveSize scales icons by 1.25 below 1024 px (phones, tablets).
const scale = vi.hoisted(() => ({ value: 1.25 }));
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size * scale.value,
  useDefaultIconSize: () => 20 * scale.value,
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
// The sheet's body: full sheet width with the player's px-4 content padding.
const sheet = vi.hoisted(() => ({ width: 360 }));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? (
      <div data-testid='sheet' className='overflow-y-auto px-4' style={{ width: sheet.width }}>
        {children}
      </div>
    ) : null,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasHaptics: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => ({ ttsRate: 1 }), setViewSettings: vi.fn() }),
}));
vi.mock('@/store/settingsStore', () => {
  const state = { settings: { globalViewSettings: { ttsRate: 1 } }, setSettings: vi.fn() };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => null }),
  useBookData: () => ({ book: { title: 'Alice' } }),
  useBookConfig: () => null,
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/store/readerProgressStore', () => ({
  useBookProgress: () => ({ sectionLabel: 'Chapter 1' }),
  getBookProgress: () => null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null }) }));
vi.mock('@/hooks/useQuotaStats', () => ({ useQuotaStats: () => ({ userProfilePlan: 'free' }) }));

const { default: TTSPlayerSheet } = await import('@/app/reader/components/tts/TTSPlayerSheet');
await import('@/styles/globals.css');
// The A-B label is measured in the app's own face, not a narrower fallback.
await document.fonts.load('600 14px Inter');

afterEach(cleanup);

const renderSheet = (width: number, iconScale: number, audioTransport = false) => {
  sheet.width = width;
  scale.value = iconScale;
  render(
    <TTSPlayerSheet
      bookKey='b1'
      isOpen
      clientsReady
      ttsLang='en'
      isPlaying={false}
      hasTimeline={false}
      audioTransport={audioTransport}
      timeoutOption={0}
      timeoutTimestamp={0}
      chapterRemainingSec={null}
      onClose={vi.fn()}
      onTogglePlay={vi.fn()}
      onBackward={vi.fn()}
      onForward={vi.fn()}
      loopState='off'
      onToggleLoop={vi.fn()}
      onGetLyricLoopRange={vi.fn().mockReturnValue(null)}
      onSetRate={vi.fn()}
      onGetVoices={vi.fn().mockResolvedValue([])}
      onSetVoice={vi.fn()}
      onGetVoiceId={vi.fn().mockReturnValue('')}
      voiceId=''
      onSelectTimeout={vi.fn()}
      onSeek={vi.fn().mockResolvedValue(undefined)}
      onSeekPreview={vi.fn()}
      onGetPlaybackInfo={vi.fn().mockReturnValue(null)}
      supportsLyrics={false}
      buffering={false}
      onGetLyrics={vi.fn().mockResolvedValue(null)}
      onGetActiveIndex={vi.fn().mockReturnValue(-1)}
      onGetLyricPage={vi.fn().mockResolvedValue(null)}
      onPlayFromLyric={vi.fn().mockResolvedValue(undefined)}
      downloads={{
        supported: false,
        chapters: [],
        statuses: new Map(),
        cacheBytes: 0,
        clearing: false,
        items: [],
        itemFor: () => undefined,
        downloadChapter: vi.fn(),
        downloadAll: vi.fn(),
        cancelChapter: vi.fn(),
        cancelAll: vi.fn(),
        clearDownloads: vi.fn().mockResolvedValue(undefined),
        statusOf: vi.fn().mockReturnValue('none'),
        refresh: vi.fn().mockResolvedValue(undefined),
      }}
      activeSectionIndex={null}
    />,
  );
  const sheetEl = document.querySelector<HTMLElement>('[data-testid="sheet"]')!;
  const play = sheetEl.querySelector<HTMLElement>('button[aria-label="Play"]')!;
  const row = play.closest<HTMLElement>('div[dir="ltr"]')!;
  const ab = row.querySelector<HTMLElement>('button[aria-label="Set Repeat Start (A)"]');
  return { sheetEl, play, row, ab };
};

const lines = (el: HTMLElement) =>
  Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));

describe('TTS player transport row', () => {
  for (const [label, iconScale] of [
    ['phone and tablet icons', 1.25],
    ['desktop icons', 1],
  ] as const) {
    it(`fits a 360 px sheet with ${label}`, () => {
      const { sheetEl, row, ab } = renderSheet(360, iconScale);

      expect(row.scrollWidth, 'the row overruns its own width').toBeLessThanOrEqual(
        row.clientWidth,
      );
      expect(sheetEl.scrollWidth, 'the sheet scrolls sideways').toBeLessThanOrEqual(
        sheetEl.clientWidth,
      );
      expect(ab!.getBoundingClientRect().right).toBeLessThanOrEqual(
        row.getBoundingClientRect().right,
      );
      expect(lines(ab!.querySelector('span')!), 'the A-B label wraps').toBe(1);
    });
  }

  for (const [label, width, audioTransport] of [
    ['on the 420 px card', 420, false],
    ['for a paired audiobook on a 360 px sheet', 360, true],
  ] as const) {
    it(`keeps its spacing ${label}`, () => {
      const { play, row } = renderSheet(width, 1.25, audioTransport);
      const cluster = play.parentElement!;
      const arrow = cluster.firstElementChild as HTMLElement;

      expect(getComputedStyle(cluster).columnGap).toBe('4px');
      expect(getComputedStyle(arrow).paddingLeft).toBe('8px');
      expect(getComputedStyle(play).marginLeft).toBe('8px');
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    });
  }
});
