import { useEffect, useState } from 'react';
import type { TTSPlayerStyle } from '@/services/tts/types';
import { useReaderStore } from '@/store/readerStore';

// How long the full card lingers after the toolbar goes away.
const LINGER_MS = 5000;

/**
 * Whether the TTS mini player should be on screen (#5310).
 *
 * The 'minimal' card is the eyes-off transport: it stays up for the whole
 * session. The 'full' card rides with the reader chrome instead -- visible
 * while the toolbar is, then lingering 5s after it clears so a dismissing tap
 * doesn't yank it away mid-glance. That's what lets the reader text stop
 * reserving a band for it (see getTTSMiniPlayerClearance).
 *
 * `mounted` is whether the card is on screen at all, and it is what arms the
 * countdown -- the caller lives as long as the reader does, so keying off its
 * own mount would burn the 5s at book-open and leave a session started without
 * the toolbar (a headset or lock-screen button) with an invisible card. It also
 * resets while the full player sheet has replaced the card, so closing the
 * sheet hands back a visible one.
 *
 * With that, one branch covers both the session start and every later toolbar
 * dismissal: no toolbar up means show the card and arm a fresh countdown.
 * Re-running on hoveredBookKey also cancels a countdown in flight when the
 * toolbar returns, so a stale remainder can never hide a card just summoned.
 */
export const useMiniPlayerAutoHide = (
  bookKey: string,
  playerStyle: TTSPlayerStyle,
  mounted: boolean,
) => {
  const { hoveredBookKey } = useReaderStore();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!mounted || playerStyle === 'minimal' || hoveredBookKey === bookKey) {
      setVisible(true);
      return;
    }
    setVisible(true);
    const timeout = setTimeout(() => setVisible(false), LINGER_MS);
    return () => clearTimeout(timeout);
  }, [mounted, playerStyle, hoveredBookKey, bookKey]);

  return visible;
};
