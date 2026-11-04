import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { getEnabledCustomTTSServices } from '@/store/customTTSStore';
import type { TTSVoice, TTSVoicesGroup } from '@/services/tts/types';
import {
  playVoicePreview,
  primeVoicePreview,
  READEST_TTS_ENGINE,
  suspendReadingForPreview,
} from '@/services/tts/voicePreview';
import { eventDispatcher } from '@/utils/event';
import { navigateToLogin } from '@/utils/nav';

export type VoicePreviewStatus = 'loading' | 'playing';

const previewKey = (group: TTSVoicesGroup, voice: TTSVoice) => `${group.engine}\u0000${voice.id}`;

// One preview at a time: starting another, or tapping the playing one, stops
// it, and so does leaving the list. A reading session playing at the time is
// stopped first; `pausedReading` says whether a preview did that since reading
// last played (the caller clears it with `clearPausedReading`).
export const useVoicePreview = (getText: (voice: TTSVoice) => { text: string; lang: string }) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  const [active, setActive] = useState<{ key: string; status: VoicePreviewStatus } | null>(null);
  const [pausedReading, setPausedReading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setActive(null);
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = (group: TTSVoicesGroup, voice: TTSVoice) => {
    const key = previewKey(group, voice);
    const wasActive = active?.key === key;
    stop();
    if (wasActive || !group.engine) return;
    // Readest Voice previews are synthesized for the reader's account.
    if (group.engine === READEST_TTS_ENGINE && !user) {
      navigateToLogin(router);
      return;
    }
    primeVoicePreview();
    const controller = new AbortController();
    abortRef.current = controller;
    setActive({ key, status: 'loading' });
    const { text, lang } = getText(voice);
    (async () => {
      try {
        if (await suspendReadingForPreview()) setPausedReading(true);
        await playVoicePreview(
          { engine: group.engine!, voiceId: voice.id, lang, text },
          controller.signal,
          {
            onStart: () => !controller.signal.aborted && setActive({ key, status: 'playing' }),
            customServices: getEnabledCustomTTSServices,
          },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        const code = error instanceof Error ? error.message : '';
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message:
            code === 'DAILY_QUOTA_EXCEEDED'
              ? _("You have used today's voice previews. Try again tomorrow")
              : code === 'NOT_AUTHENTICATED'
                ? _('Please log in to use advanced TTS features')
                : code === 'BUSY'
                  ? _('Voices are busy right now. Try again in a moment')
                  : _("Couldn't play this voice"),
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setActive(null);
        }
      }
    })();
  };

  const statusOf = (group: TTSVoicesGroup, voice: TTSVoice): VoicePreviewStatus | null =>
    active?.key === previewKey(group, voice) ? active.status : null;

  const clearPausedReading = useCallback(() => setPausedReading(false), []);

  return { toggle, stop, statusOf, pausedReading, clearPausedReading };
};
