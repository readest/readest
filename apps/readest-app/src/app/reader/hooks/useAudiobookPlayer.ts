import { useEffect, useRef, useState, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { isValidURL } from '@/utils/misc';
import { useBookDataStore } from '@/store/bookDataStore';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { useAudiobookSync, type MarkerStatus } from './useAudiobookSync';
import {
  printLiveMarkerDiag,
  incrementRetries,
  incrementSkippedUnrelocatable,
  incrementRetryCapHits,
} from '@/utils/liveMarker';
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
  // Entries that are truly dead (consumed: true) are skipped forever.
  // Successfully applied entries (consumed: false) can be revisited for
  // progress updates on subsequent timeupdates within the same entry window.
  const deadEntryKeysRef = useRef<Set<string>>(new Set());
  // Bad-entry suppression: entries that repeatedly fail relocation/application
  // are skipped for the rest of this playback session.
  const suppressedKeysRef = useRef<Set<string>>(new Set());
  const retryCountsRef = useRef<Map<string, number>>(new Map());
  const MAX_RETRIES = 3;
  // Exported for diagnostics
  const retryCapHitsRef = useRef(0);

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

  // True mount/unmount log — runs only when the audio element lifecycle changes
  useEffect(() => {
    console.log('[SyncPlayback] audiobook player MOUNTED', {
      bookKey,
      hasAudiobook: !!audiobookConfig,
      filePath: filePath?.slice(-40),
      syncStatus: audiobookConfig?.syncStatus,
      syncMapLen: audiobookConfig?.syncMap?.length ?? 0,
    });
    return () => {
      console.log('[SyncPlayback] audiobook player UNMOUNTED', { bookKey });
    };
    // Run once per bookKey + audioSrc pairing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSrc, bookKey]);

  useEffect(() => {
    console.log('[SyncPlayback] audio element setup START', {
      bookKey,
      hasAudioSrc: !!audioSrc,
    });
    if (!audioSrc) {
      console.log('[SyncPlayback] useEffect SKIP — no audioSrc (no audiobook attached?)');
      return;
    }

    console.log('[SyncPlayback] useEffect creating audio element for', audioSrc);

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
      console.log('[SyncPlayback] loadedmetadata', { duration: audio.duration, savedTime });
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

      // Auto-generate sync map if audiobook is attached but no sync exists
      const audiobook = config?.audiobook;
      if (
        audiobook &&
        !audiobook.syncMap?.length &&
        !audiobook.syncPoints?.length &&
        audiobook.syncStatus !== 'pending' &&
        audiobook.syncStatus !== 'error'
      ) {
        eventDispatcher.dispatch('audiobook-sync-auto-generate', { bookKey });
      }
    };

    let tickCount = 0;
    let lastStatusLog = '';
    const handleTimeUpdate = () => {
      tickCount++;
      const time = audio.currentTime;
      // ── UNCONDITIONAL every 30 ticks ──
      if (tickCount === 1 || tickCount % 30 === 0) {
        console.log('[SyncPlayback] timeupdate #' + tickCount, 't=' + time.toFixed(2));
      }
      setCurrentTime(time);
      saveTime(time);

      const config = useBookDataStore.getState().getConfig(bookKey);
      const audiobook = config?.audiobook;

      if (!audiobook) {
        if (lastStatusLog !== 'no-audiobook') {
          console.log(
            '[SyncPlayback] tick',
            tickCount,
            't=',
            time.toFixed(2),
            '— no audiobook in config',
          );
          lastStatusLog = 'no-audiobook';
        }
        return;
      }

      const status = audiobook.syncStatus ?? 'undefined';
      const mapLen = audiobook.syncMap?.length ?? 0;
      const pointLen = audiobook.syncPoints?.length ?? 0;

      if (status !== 'ready') {
        const key = `${status}|${mapLen}|${pointLen}`;
        if (key !== lastStatusLog) {
          console.log(
            '[SyncPlayback] tick',
            tickCount,
            't=',
            time.toFixed(2),
            '— syncStatus=',
            status,
            'syncMap=',
            mapLen,
            'syncPoints=',
            pointLen,
          );
          lastStatusLog = key;
        }
        return;
      }

      const syncMap = resolveSyncMap(audiobook);
      let entry = findAudiobookSyncEntryAtTime(syncMap, time);

      if (!entry) {
        if (lastStatusLog !== 'no-entry') {
          // Find nearest entries for diagnostics
          let prevEntry: AudiobookSyncMapEntry | null = null;
          let nextEntry: AudiobookSyncMapEntry | null = null;
          for (const e of syncMap) {
            if (e.secondsStart <= time) prevEntry = e;
            if (!nextEntry && e.secondsStart > time) nextEntry = e;
          }
          console.log(
            '[SyncPlayback] tick',
            tickCount,
            't=',
            time.toFixed(2),
            '— no entry found (mapSize=',
            syncMap.length,
            ')',
            'prev=',
            prevEntry
              ? `${prevEntry.secondsStart.toFixed(1)}-${(prevEntry.secondsEnd ?? -1).toFixed(1)} s${prevEntry.sectionIndex ?? '?'}`
              : 'none',
            'next=',
            nextEntry
              ? `${nextEntry.secondsStart.toFixed(1)}-${(nextEntry.secondsEnd ?? -1).toFixed(1)} s${nextEntry.sectionIndex ?? '?'}`
              : 'none',
          );
          lastStatusLog = 'no-entry';
        }
        return;
      }

      lastStatusLog = '';
      const entryKey = getSyncMapEntryKey(entry);
      // Skip only truly dead entries (consumed: true from previous call).
      // Successfully applied entries (consumed: false) are re-called on each
      // timeupdate so the word window advances with progress.
      if (deadEntryKeysRef.current.has(entryKey)) return;

      // ── Bad-entry suppression ──
      if (suppressedKeysRef.current.has(entryKey)) {
        incrementSkippedUnrelocatable();
        // Advance past this entry: try the next one
        const nextEntry = findAudiobookSyncEntryAtTime(
          syncMap,
          (entry.secondsEnd ?? entry.secondsStart) + 0.01,
          entry.trackIndex,
        );
        if (nextEntry && getSyncMapEntryKey(nextEntry) !== entryKey) {
          entry = nextEntry;
        } else {
          return; // no next entry available yet
        }
      }

      // ── Retry cap ──
      const retryCount = retryCountsRef.current.get(entryKey) ?? 0;
      if (retryCount >= MAX_RETRIES) {
        suppressedKeysRef.current.add(entryKey);
        retryCapHitsRef.current++;
        incrementRetryCapHits();
        console.log('[SyncPlayback] entry RETRY-CAPPED → suppressed', {
          entryKey: entryKey.slice(0, 40),
          retryCount,
        });
        return;
      }

      // ── Pipeline diagnostic: entry found ──
      const effectiveCfi = entry.markerCfi || entry.cfi;

      // Progress within this sync entry for word-level highlighting
      const entryDuration = (entry.secondsEnd ?? audiobook.duration ?? 0) - entry.secondsStart;
      const wordProgress =
        entryDuration > 0
          ? Math.max(0, Math.min(1, (time - entry.secondsStart) / entryDuration))
          : 0;

      console.log('[SyncPlayback] ENTRY found @ tick', tickCount, 't=', time.toFixed(2), {
        secondsStart: entry.secondsStart,
        secondsEnd: entry.secondsEnd,
        sectionIndex: entry.sectionIndex,
        sectionHref: entry.sectionHref?.slice(-40),
        cfi: effectiveCfi?.slice(0, 60) || '(empty)',
        markerCfi: entry.markerCfi?.slice(0, 60),
        label: entry.label,
        source: entry.source,
        matchScore: entry.matchScore,
        wordProgress: Math.round(wordProgress * 1000) / 1000,
        retryCount,
        suppressed: suppressedKeysRef.current.has(entryKey),
      });

      try {
        const result: MarkerStatus = applyAudiobookMarker({
          cfi: effectiveCfi,
          sectionIndex: entry.sectionIndex,
          sectionHref: entry.sectionHref,
          label: entry.label,
          progress: wordProgress,
        });
        console.log('[SyncPlayback] applyAudiobookMarker result:', {
          needsRetry: result.needsRetry,
          consumed: result.consumed,
          cfi: effectiveCfi?.slice(0, 60),
        });
        if (result.consumed) {
          // Truly dead entry — never revisit
          deadEntryKeysRef.current.add(entryKey);
          retryCountsRef.current.delete(entryKey);
          console.log('[SyncPlayback] entry DEAD', { entryKey: entryKey.slice(0, 40) });
        } else if (result.needsRetry) {
          // Relocation pending — retry soon
          incrementRetries();
          retryCountsRef.current.set(entryKey, retryCount + 1);
          console.log('[SyncPlayback] entry retry pending', {
            entryKey: entryKey.slice(0, 40),
            retryCount: retryCount + 1,
          });
        } else {
          // Applied successfully — allow progress updates on future calls
          lastAppliedEntryKeyRef.current = entryKey;
          retryCountsRef.current.delete(entryKey);
          console.log('[SyncPlayback] marker applied (progress update allowed)', {
            entryKey: entryKey.slice(0, 40),
            progress: Math.round(wordProgress * 1000) / 1000,
          });
        }
      } catch (err) {
        console.warn('[AudiobookSync] Failed to apply marker', {
          secondsStart: entry.secondsStart,
          cfi: entry.cfi?.slice(0, 60),
          label: entry.label,
          error: err,
        });
      }
    };

    const handlePlay = () => {
      console.log('[SyncPlayback] play event');
      setIsPlaying(true);
    };
    const handlePause = () => {
      console.log('[SyncPlayback] pause event');
      setIsPlaying(false);
      saveTime.flush();
      printLiveMarkerDiag();
    };
    const handleEnded = () => {
      console.log('[SyncPlayback] ended event');
      setIsPlaying(false);
      saveTime.flush();
      printLiveMarkerDiag();
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
    console.log('[SyncPlayback] listeners attached to', {
      src: audioSrc.slice(0, 50),
      audioId: (audio as unknown as { id?: string }).id ?? 'no-id',
    });
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
      deadEntryKeysRef.current.clear();
      suppressedKeysRef.current.clear();
      retryCountsRef.current.clear();
      audio.src = '';
      audioRef.current = null;
      printLiveMarkerDiag();
      console.log('[SyncPlayback] audio element setup CLEANUP', { bookKey });
    };
    // audioSrc encodes filePath; bookKey is stable per reader panel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSrc, bookKey, clearAudiobookMarker]);

  const handleTogglePlay = useCallback(() => {
    const audio = audioRef.current;
    console.log('[SyncPlayback] handleTogglePlay', {
      hasAudio: !!audio,
      isLoaded,
      isPlaying,
      audioSrc: audio?.src?.slice(-40),
    });
    if (!audio || !isLoaded) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((e) => console.error('[SyncPlayback] play() failed', e));
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
              const entryDuration =
                (entry.secondsEnd ?? config.audiobook.duration ?? 0) - entry.secondsStart;
              const seekProgress =
                entryDuration > 0
                  ? Math.max(0, Math.min(1, (time - entry.secondsStart) / entryDuration))
                  : 0;
              try {
                applyAudiobookMarker({
                  cfi: entry.markerCfi || entry.cfi,
                  sectionIndex: entry.sectionIndex,
                  sectionHref: entry.sectionHref,
                  label: entry.label,
                  progress: seekProgress,
                });
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
