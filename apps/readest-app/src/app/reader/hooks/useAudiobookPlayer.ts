import { useEffect, useRef, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { isValidURL } from '@/utils/misc';
import { useBookDataStore } from '@/store/bookDataStore';
import { debounce } from '@/utils/debounce';
import { useAudiobookSync } from './useAudiobookSync';
import {
  buildSyncMapFromPoints,
  findAudiobookSyncEntryAtTime,
  getSyncMapEntryKey,
} from '@/utils/audiobookSync';
import { AudiobookConfig, AudiobookSyncMapEntry } from '@/types/book';

interface UseAudiobookPlayerProps {
  bookKey: string;
}

/**
 * Derives the runtime sync map from audiobook config.
 * Prefers an explicit `syncMap` if present and non-empty;
 * otherwise builds one from `syncPoints`.
 */
function resolveSyncMap(audiobook: AudiobookConfig): AudiobookSyncMapEntry[] {
  if (audiobook.syncMap && audiobook.syncMap.length > 0) {
    return audiobook.syncMap;
  }
  if (audiobook.syncPoints && audiobook.syncPoints.length > 0) {
    return buildSyncMapFromPoints(audiobook.syncPoints, { duration: audiobook.duration });
  }
  return [];
}

export const useAudiobookPlayer = ({ bookKey }: UseAudiobookPlayerProps) => {
  const { getConfig } = useBookDataStore();
  const { applyAudiobookMarker, clearAudiobookMarker } = useAudiobookSync({ bookKey });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAppliedEntryKeyRef = useRef<string | null>(null);

  const audiobookConfig = getConfig(bookKey)?.audiobook;
  const filePath = audiobookConfig?.filePath;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(audiobookConfig?.duration ?? 0);
  const [loadError, setLoadError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const audioSrc = filePath
    ? isTauriAppPlatform() && !isValidURL(filePath)
      ? convertFileSrc(filePath)
      : filePath
    : null;

  useEffect(() => {
    if (!audioSrc) return;

    const saveTime = debounce((time: number) => {
      const state = useBookDataStore.getState();
      const config = state.getConfig(bookKey);
      if (!config?.audiobook) return;
      state.setConfig(bookKey, {
        audiobook: { ...config.audiobook, currentTime: time },
        updatedAt: Date.now(),
      });
    }, 3000);

    const audio = new Audio();
    audioRef.current = audio;
    setLoadError(false);
    setIsLoaded(false);
    setIsPlaying(false);

    const savedTime = audiobookConfig?.currentTime ?? 0;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoaded(true);
      if (savedTime > 0 && savedTime < audio.duration - 1) {
        audio.currentTime = savedTime;
        setCurrentTime(savedTime);
      }
      // Persist duration if not yet stored
      const state = useBookDataStore.getState();
      const config = state.getConfig(bookKey);
      if (config?.audiobook && !config.audiobook.duration) {
        state.setConfig(bookKey, {
          audiobook: { ...config.audiobook, duration: audio.duration },
          updatedAt: Date.now(),
        });
      }
    };

    const handleTimeUpdate = () => {
      const time = audio.currentTime;
      setCurrentTime(time);
      saveTime(time);

      const config = useBookDataStore.getState().getConfig(bookKey);
      const audiobook = config?.audiobook;
      if (audiobook?.syncStatus === 'ready') {
        const syncMap = resolveSyncMap(audiobook);
        const entry = findAudiobookSyncEntryAtTime(syncMap, time);
        if (entry) {
          const entryKey = getSyncMapEntryKey(entry);
          if (entryKey !== lastAppliedEntryKeyRef.current) {
            try {
              applyAudiobookMarker(entry.markerCfi || entry.cfi);
              lastAppliedEntryKeyRef.current = entryKey;
            } catch (err) {
              console.warn('[AudiobookSync] Failed to apply marker', {
                secondsStart: entry.secondsStart,
                cfi: entry.cfi,
                label: entry.label,
                error: err,
              });
            }
          }
        }
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => {
      setIsPlaying(false);
      saveTime.flush();
    };
    const handleEnded = () => {
      setIsPlaying(false);
      saveTime.flush();
    };
    const handleError = () => {
      const err = audio.error;
      console.error('[AudiobookPlayer] Failed to load audio', {
        filePath,
        audioSrc,
        code: err?.code,
        message: err?.message,
      });
      setLoadError(true);
      setIsLoaded(false);
    };

    audio.preload = 'metadata';
    audio.src = audioSrc;
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.load();

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      // Save position on cleanup before cancelling debounce
      if (audio.currentTime > 0) {
        saveTime.cancel();
        const state = useBookDataStore.getState();
        const config = state.getConfig(bookKey);
        if (config?.audiobook) {
          state.setConfig(bookKey, {
            audiobook: { ...config.audiobook, currentTime: audio.currentTime },
            updatedAt: Date.now(),
          });
        }
      } else {
        saveTime.cancel();
      }
      clearAudiobookMarker();
      lastAppliedEntryKeyRef.current = null;
      audio.src = '';
      audioRef.current = null;
    };
    // audioSrc encodes filePath; bookKey is stable per reader panel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSrc, bookKey, clearAudiobookMarker]);

  const handleTogglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isLoaded) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  }, [isPlaying, isLoaded]);

  const handleSeek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || !isLoaded) return;
      audio.currentTime = time;
      setCurrentTime(time);
      // Immediate in-memory save on seek
      const state = useBookDataStore.getState();
      const config = state.getConfig(bookKey);
      if (config?.audiobook) {
        state.setConfig(bookKey, {
          audiobook: { ...config.audiobook, currentTime: time },
          updatedAt: Date.now(),
        });

        if (config.audiobook.syncStatus === 'ready') {
          const syncMap = resolveSyncMap(config.audiobook);
          const entry = findAudiobookSyncEntryAtTime(syncMap, time);
          if (entry) {
            const entryKey = getSyncMapEntryKey(entry);
            if (entryKey !== lastAppliedEntryKeyRef.current) {
              try {
                applyAudiobookMarker(entry.markerCfi || entry.cfi);
                lastAppliedEntryKeyRef.current = entryKey;
              } catch (err) {
                console.warn('[AudiobookSync] Failed to apply marker on seek', {
                  secondsStart: entry.secondsStart,
                  cfi: entry.cfi,
                  label: entry.label,
                  error: err,
                });
              }
            }
          }
        }
      }
    },
    [isLoaded, bookKey, applyAudiobookMarker],
  );

  const handleSkipBack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isLoaded) return;
    audio.currentTime = Math.max(0, audio.currentTime - 10);
    setCurrentTime(audio.currentTime);
  }, [isLoaded]);

  const handleSkipForward = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !isLoaded) return;
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
    setCurrentTime(audio.currentTime);
  }, [isLoaded]);

  return {
    audiobookConfig,
    isPlaying,
    isLoaded,
    loadError,
    currentTime,
    duration,
    handleTogglePlay,
    handleSeek,
    handleSkipBack,
    handleSkipForward,
  };
};
