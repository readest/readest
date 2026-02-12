import { useRef } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { SILENCE_DATA } from '@/services/tts';
import { getMediaSession, TauriMediaSession } from '@/libs/mediaSession';
import { fetchImageAsBase64 } from '@/utils/image';

interface UseTTSMediaSessionProps {
  bookKey: string;
}

export const useTTSMediaSession = ({ bookKey }: UseTTSMediaSessionProps) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getProgress } = useReaderStore();

  const mediaSessionRef = useRef<TauriMediaSession | MediaSession | null>(null);
  const unblockerAudioRef = useRef<HTMLAudioElement | null>(null);

  // this enables WebAudio to play even when the mute toggle switch is ON
  const unblockAudio = () => {
    if (unblockerAudioRef.current) return;
    unblockerAudioRef.current = document.createElement('audio');
    unblockerAudioRef.current.setAttribute('x-webkit-airplay', 'deny');
    unblockerAudioRef.current.addEventListener('play', () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
      }
    });
    unblockerAudioRef.current.preload = 'auto';
    unblockerAudioRef.current.loop = true;
    unblockerAudioRef.current.src = SILENCE_DATA;
    unblockerAudioRef.current.play();
  };

  const releaseUnblockAudio = () => {
    if (!unblockerAudioRef.current) return;
    try {
      unblockerAudioRef.current.pause();
      unblockerAudioRef.current.currentTime = 0;
      unblockerAudioRef.current.removeAttribute('src');
      unblockerAudioRef.current.src = '';
      unblockerAudioRef.current.load();
      unblockerAudioRef.current = null;
      console.log('Unblock audio released');
    } catch (err) {
      console.warn('Error releasing unblock audio:', err);
    }
  };

  const initMediaSession = async () => {
    const mediaSession = getMediaSession();
    if (!mediaSession) return;

    mediaSessionRef.current = mediaSession;

    if (mediaSession instanceof TauriMediaSession) {
      const bookData = getBookData(bookKey);
      const progress = getProgress(bookKey);
      if (!bookData || !bookData.book) return;
      const { title, author, coverImageUrl } = bookData.book;
      const { sectionLabel } = progress || {};

      let artworkImage = '/icon.png';
      try {
        artworkImage = await fetchImageAsBase64(coverImageUrl || '/icon.png');
      } catch {
        artworkImage = await fetchImageAsBase64('/icon.png');
      }

      await mediaSession.setActive({
        active: true,
        keepAppInForeground: settings.alwaysInForeground,
        notificationTitle: _('Read Aloud'),
        notificationText: _('Ready to read aloud'),
        foregroundServiceTitle: _('Read Aloud'),
        foregroundServiceText: _('Ready to read aloud'),
      });
      mediaSession.updateMetadata({
        title: title,
        artist: sectionLabel || title,
        album: author,
        artwork: artworkImage,
      });
    }
  };

  const deinitMediaSession = async () => {
    if (mediaSessionRef.current && mediaSessionRef.current instanceof TauriMediaSession) {
      await mediaSessionRef.current.setActive({
        active: false,
        keepAppInForeground: settings.alwaysInForeground,
      });
    }
    mediaSessionRef.current = null;
  };

  return {
    mediaSessionRef,
    unblockerAudioRef,
    unblockAudio,
    releaseUnblockAudio,
    initMediaSession,
    deinitMediaSession,
  };
};
