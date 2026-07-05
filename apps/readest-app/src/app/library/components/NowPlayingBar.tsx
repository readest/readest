import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MdClose, MdPauseCircleFilled, MdPlayCircleFilled } from 'react-icons/md';
import { ttsSessionManager, TTSSession } from '@/services/tts';
import { useBookDataStore } from '@/store/bookDataStore';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';

const formatCountdown = (msLeft: number) => {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

interface NowPlayingBarProps {
  isSelectMode: boolean;
}

// Floating pill shown while a background TTS session is alive: the only
// in-app surface for a session whose reader is closed. Tap body reopens the
// book IN THIS WINDOW (bypassing openBookInNewWindow deliberately: the
// session is a per-webview singleton, and a new window would open a reader
// with no TTS while audio haunts this one).
const NowPlayingBar = ({ isSelectMode }: NowPlayingBarProps) => {
  const _ = useTranslation();
  const router = useRouter();
  const { safeAreaInsets } = useThemeStore();
  const { getBookData } = useBookDataStore();
  const [session, setSession] = useState<TTSSession | null>(() =>
    ttsSessionManager.getActiveSession(),
  );
  const [isPlaying, setIsPlaying] = useState(
    () => ttsSessionManager.getActiveSession()?.controller.state === 'playing',
  );
  const [stopping, setStopping] = useState(false);
  const [entered, setEntered] = useState(false);
  const [timerLabel, setTimerLabel] = useState('');

  useEffect(() => {
    const onSessionChanged = () => {
      const active = ttsSessionManager.getActiveSession();
      setSession(active);
      if (!active) setStopping(false);
      setIsPlaying(active ? active.controller.state === 'playing' : false);
    };
    ttsSessionManager.addEventListener('session-changed', onSessionChanged);
    // The glyph follows the manager-relayed channel so lock-screen transport
    // keeps the bar truthful — not local optimistic taps.
    const onPlaybackState = (event: CustomEvent) => {
      const { state } = event.detail as { state: string };
      if (state === 'playing') setIsPlaying(true);
      else if (state === 'paused') setIsPlaying(false);
    };
    eventDispatcher.on('tts-playback-state', onPlaybackState);
    return () => {
      ttsSessionManager.removeEventListener('session-changed', onSessionChanged);
      eventDispatcher.off('tts-playback-state', onPlaybackState);
    };
  }, []);

  const visible = !!session && !stopping && !isSelectMode;

  // Slide-up entrance; last shelf row scrolls clear via the inset var the
  // bookshelf padding consumes.
  useEffect(() => {
    if (!visible) {
      setEntered(false);
      document.body.style.removeProperty('--now-playing-inset');
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    document.body.style.setProperty('--now-playing-inset', '64px');
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.removeProperty('--now-playing-inset');
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const tick = () => {
      const timer = ttsSessionManager.getSleepTimer();
      setTimerLabel(timer ? formatCountdown(timer.firesAt - Date.now()) : '');
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const book = getBookData(session.bookKey)?.book;
  const title = book?.title ?? '';
  const coverImageUrl = book?.coverImageUrl;

  const handleToggle = () => {
    const controller = session.controller;
    if (controller.state === 'playing') {
      void controller.pause();
    } else if (controller.state.includes('paused')) {
      void controller.start();
    }
  };

  const handleStop = () => {
    // Optimistic hide; the manager's stop is single-flight and the
    // session-changed event confirms.
    setStopping(true);
    void ttsSessionManager.stopActive('user');
  };

  const handleOpen = () => {
    navigateToReader(router, [session.bookHash]);
  };

  return (
    <div
      role='status'
      aria-label={`${_('Reading aloud')}: ${title}`}
      className={clsx(
        'fixed bottom-0 start-1/2 z-40 -translate-x-1/2 rtl:translate-x-1/2',
        'motion-safe:transition-all motion-safe:duration-200',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
      style={{ paddingBottom: `${(safeAreaInsets?.bottom ?? 0) + 16}px` }}
    >
      <div
        role='button'
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleOpen();
        }}
        aria-label={`${_('Open Book')}: ${title}`}
        className={clsx(
          'not-eink:bg-base-300 eink-bordered flex items-center gap-2 rounded-full shadow-lg',
          'h-11 max-w-[calc(100vw-1rem)] cursor-pointer ps-2 pe-1',
          'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        {coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverImageUrl} alt='' className='h-8 w-8 shrink-0 rounded-full object-cover' />
        ) : null}
        <span className='min-w-0 flex-1 truncate text-sm'>{title}</span>
        {timerLabel && (
          <span className='shrink-0 text-xs tabular-nums opacity-70'>{timerLabel}</span>
        )}
        <button
          type='button'
          className='touch-target shrink-0 p-1 focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none'
          aria-label={isPlaying ? _('Pause') : _('Play')}
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
        >
          {isPlaying ? <MdPauseCircleFilled size={28} /> : <MdPlayCircleFilled size={28} />}
        </button>
        <button
          type='button'
          className='touch-target shrink-0 p-1 focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none'
          aria-label={_('Stop reading aloud')}
          onClick={(e) => {
            e.stopPropagation();
            handleStop();
          }}
        >
          <MdClose size={22} />
        </button>
      </div>
    </div>
  );
};

export default NowPlayingBar;
