'use client';

import { useEffect, useRef } from 'react';
import { useAtmosphereStore } from '@/store/atmosphereStore';
import { useThemeStore } from '@/store/themeStore';

const AtmosphereOverlay = () => {
  const active = useAtmosphereStore((s) => s.active);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isInitialMount = useRef(true);

  const audioSrc = isDarkMode ? '/assets/forest-crickets.mp3' : '/assets/forest-birds.mp3';

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;

    if (active) {
      document.body.classList.add('atmosphere');
      video?.play()?.catch(() => {});
      if (!isInitialMount.current) {
        audio?.play()?.catch(() => {});
      }
    } else {
      document.body.classList.remove('atmosphere');
    }
    isInitialMount.current = false;
  }, [active]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !active) return;
    audio.src = audioSrc;
    audio.play()?.catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSrc]);

  return (
    <>
      {active && (
        <video
          ref={videoRef}
          id='atmosphere-overlay'
          src='/assets/komorebi.mp4'
          loop
          muted
          playsInline
          preload='none'
        />
      )}
      {active && (
        // biome-ignore lint/a11y/useMediaCaption: ambient background audio, no spoken content
        <audio ref={audioRef} id='forest-audio' src={audioSrc} loop preload='none' />
      )}
    </>
  );
};

export default AtmosphereOverlay;
