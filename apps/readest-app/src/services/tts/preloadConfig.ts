// Number of sentence audio requests prepared concurrently before playback needs
// them. Kept small and bounded: providers are user-configured endpoints and a
// large fan-out can overwhelm a local server or spend unnecessary API credit.
export const TTS_PRELOAD_OPTIONS = [2, 4, 6, 8] as const;
export type TTSPreloadCount = (typeof TTS_PRELOAD_OPTIONS)[number];

const STORAGE_KEY = 'readest-tts-preload-count';
const DEFAULT_PRELOAD_COUNT: TTSPreloadCount = 6;

export function getTTSPreloadCount(): TTSPreloadCount {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return TTS_PRELOAD_OPTIONS.includes(value as TTSPreloadCount)
      ? (value as TTSPreloadCount)
      : DEFAULT_PRELOAD_COUNT;
  } catch {
    return DEFAULT_PRELOAD_COUNT;
  }
}

export function setTTSPreloadCount(count: TTSPreloadCount): void {
  localStorage.setItem(STORAGE_KEY, String(count));
}
