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

// A narrated book's own recording, as TTSController.getVoices puts it first.
const NARRATION: TTSVoicesGroup = {
  id: 'media-overlay',
  name: 'Narration',
  engine: 'media-overlay',
  voices: [{ id: 'media-overlay', name: 'Jim Dale', lang: 'en' }],
};

const renderList = (
  onSelect = vi.fn(),
  {
    groups = GROUPS,
    selected = null,
  }: {
    groups?: TTSVoicesGroup[];
    selected?: { engine?: string; voiceId: string } | null;
  } = {},
) => {
  render(
    <VoiceList
      groups={groups}
      selected={selected}
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
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-GB-RyanNeural');
    renderList();

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

  // Rows that came or went above the one being tapped would move it from
  // under the finger, so the Favorites list changes only on the next open.
  it('keeps the rows in place while the list is open', () => {
    renderList();
    const heart = screen.getByRole('button', { name: 'Add Ryan to favorites' });
    fireEvent.click(heart);

    expect(screen.queryByText('Favorites')).toBeNull();
    expect(heart.getAttribute('aria-label')).toBe('Remove Ryan from favorites');
    expect(TTSUtils.getFavoriteVoices()).toEqual([
      TTSUtils.favoriteVoiceKey('edge-tts', 'en-GB-RyanNeural'),
    ]);
  });

  it('removes a favorite, keeping its row and focus until the next open', () => {
    TTSUtils.toggleFavoriteVoice('readest-tts', 'kokoro:af_heart');
    renderList();
    const favorites = screen.getByText('Favorites').parentElement!;
    const heart = within(favorites).getByRole('button', { name: 'Remove Heart from favorites' });
    heart.focus();

    fireEvent.click(heart);

    expect(heart.isConnected).toBe(true);
    expect(document.activeElement).toBe(heart);
    expect(screen.getAllByRole('button', { name: 'Add Heart to favorites' })).toHaveLength(2);
    expect(TTSUtils.getFavoriteVoices()).toEqual([]);

    cleanup();
    renderList();
    expect(screen.queryByText('Favorites')).toBeNull();
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
    expect(screen.getByText('Favorites')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Female' }));

    expect(screen.queryByText('Favorites')).toBeNull();
  });

  it("keeps the book's narrator first, with no heart", () => {
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-GB-RyanNeural');
    renderList(vi.fn(), { groups: [NARRATION, ...GROUPS] });

    expect(sectionTitles()).toEqual(['Narration', 'Favorites', 'Readest Voice', 'Edge TTS']);
    expect(screen.queryByRole('button', { name: /^(Add|Remove) Jim Dale/ })).toBeNull();
  });

  it('marks the voice in use as current once', () => {
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-GB-RyanNeural');
    renderList(vi.fn(), { selected: { engine: 'edge-tts', voiceId: 'en-GB-RyanNeural' } });

    const favorites = screen.getByText('Favorites').parentElement!;
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(favorites.querySelector('[aria-current]')).toBeNull();
  });
});
