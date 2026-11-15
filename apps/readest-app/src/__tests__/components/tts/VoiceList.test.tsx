// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { TTSVoicesGroup } from '@/services/tts/types';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, opts?: Record<string, unknown>) =>
    opts ? key.replace(/{{(\w+)}}/g, (_m, k) => String(opts[k])) : key,
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getLocale: () => 'en-US',
}));
vi.mock('@/services/tts/voicePreview', () => ({
  canPreviewEngine: () => false,
}));

import { TTSUtils } from '@/services/tts/TTSUtils';
import VoiceList from '@/components/tts/VoiceList';

const GROUPS: TTSVoicesGroup[] = [
  {
    id: 'readest-tts',
    name: 'Readest Voice',
    engine: 'readest-tts',
    voices: [{ id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', gender: 'female' }],
  },
  {
    id: 'edge-tts',
    name: 'Edge TTS',
    engine: 'edge-tts',
    voices: [
      { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US', gender: 'female' },
      { id: 'en-GB-RyanNeural', name: 'Ryan', lang: 'en-GB', gender: 'male' },
    ],
  },
];

const renderList = (onSelect = vi.fn()) => {
  render(
    <VoiceList
      groups={GROUPS}
      selected={null}
      onSelect={onSelect}
      onUpgrade={vi.fn()}
      preview={{ toggle: vi.fn(), statusOf: () => null }}
    />,
  );
  return onSelect;
};

// A section's heading is the boxed list's title; its rows are the buttons
// inside the list that follows it.
const sectionTitles = () =>
  screen
    .queryAllByRole('heading')
    .map((heading) => heading.textContent)
    .filter(Boolean);

describe('VoiceList favorites', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(cleanup);

  it('shows no Favorites section until a voice is favorited', () => {
    renderList();
    expect(screen.queryByText('Favorites')).toBeNull();
  });

  it('puts a favorited voice in a Favorites section above every engine group', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Add Ryan to favorites' }));

    const titles = sectionTitles();
    expect(titles[0]).toBe('Favorites');
    expect(titles.indexOf('Favorites')).toBeLessThan(titles.indexOf('Readest Voice'));
    expect(titles.indexOf('Favorites')).toBeLessThan(titles.indexOf('Edge TTS'));
    // The voice is listed there and stays in its own group too.
    expect(screen.getAllByText('Ryan')).toHaveLength(2);
  });

  it('persists a favorite and shows it on the next render', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Add Aria to favorites' }));
    cleanup();

    renderList();

    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove Aria from favorites' })).toHaveLength(2);
  });

  it('removes a favorite, and the section when none are left', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Add Heart to favorites' }));
    expect(screen.getByText('Favorites')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Heart from favorites' })[0]!);

    expect(screen.queryByText('Favorites')).toBeNull();
    expect(TTSUtils.getFavoriteVoices()).toEqual([]);
  });

  it('chooses a voice from the Favorites section with its own group', () => {
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-GB-RyanNeural');
    const onSelect = renderList();

    // The heading sits directly inside its boxed list's wrapper.
    const favorites = screen.getByText('Favorites').parentElement!;
    fireEvent.click(within(favorites).getByText('Ryan'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'edge-tts' }),
      expect.objectContaining({ id: 'en-GB-RyanNeural' }),
    );
  });

  it('hides favorites the gender filter excludes', () => {
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-GB-RyanNeural');
    renderList();

    fireEvent.click(screen.getByRole('radio', { name: 'Female' }));

    expect(screen.queryByText('Favorites')).toBeNull();
  });
});
