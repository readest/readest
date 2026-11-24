// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSUtils } from '@/services/tts/TTSUtils';

describe('TTSUtils favorite voices', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with no favorites', () => {
    expect(TTSUtils.getFavoriteVoices()).toEqual([]);
  });

  it('toggles a voice on and off, reporting the new state', () => {
    expect(TTSUtils.toggleFavoriteVoice('edge-tts', 'en-US-AriaNeural')).toBe(true);
    expect(TTSUtils.getFavoriteVoices()).toEqual([
      TTSUtils.favoriteVoiceKey('edge-tts', 'en-US-AriaNeural'),
    ]);

    expect(TTSUtils.toggleFavoriteVoice('edge-tts', 'en-US-AriaNeural')).toBe(false);
    expect(TTSUtils.getFavoriteVoices()).toEqual([]);
  });

  it('keeps the same voice id on two engines apart', () => {
    TTSUtils.toggleFavoriteVoice('edge-tts', 'shared-id');
    TTSUtils.toggleFavoriteVoice('web-speech', 'shared-id');
    TTSUtils.toggleFavoriteVoice('edge-tts', 'shared-id');

    expect(TTSUtils.getFavoriteVoices()).toEqual([
      TTSUtils.favoriteVoiceKey('web-speech', 'shared-id'),
    ]);
  });

  it('does not disturb the preferred voices', () => {
    TTSUtils.setPreferredVoice('edge-tts', 'en', 'en-US-AriaNeural');
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-US-GuyNeural');

    expect(TTSUtils.getPreferredVoice('edge-tts', 'en')).toBe('en-US-AriaNeural');
  });

  it('survives corrupt stored data', () => {
    localStorage.setItem('ttsFavoriteVoices', '{not json');
    expect(TTSUtils.getFavoriteVoices()).toEqual([]);
    expect(TTSUtils.toggleFavoriteVoice('edge-tts', 'x')).toBe(true);
  });

  it('leaves the favorites as they were when storage refuses the write', () => {
    TTSUtils.toggleFavoriteVoice('edge-tts', 'en-US-AriaNeural');
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    expect(TTSUtils.toggleFavoriteVoice('edge-tts', 'en-US-GuyNeural')).toBe(false);
    expect(TTSUtils.toggleFavoriteVoice('edge-tts', 'en-US-AriaNeural')).toBe(true);
    expect(TTSUtils.getFavoriteVoices()).toEqual([
      TTSUtils.favoriteVoiceKey('edge-tts', 'en-US-AriaNeural'),
    ]);
  });
});
