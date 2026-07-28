import React, { useEffect, useRef, useState } from 'react';
import { CLIP_SIGNIN_CONFIRM_EVENT } from '@/services/send/clipSignIn';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { eventDispatcher } from '@/utils/event';
import Alert from './Alert';

interface ClipSignInRequest {
  url: string;
  respond: (ok: boolean) => void;
}

/**
 * Confirm step for the login-wall clip fallback (#5262). Listens for the
 * sync event `clipPageWithSignInFallback` dispatches and asks the user
 * whether to open the page for a manual sign-in + capture. Mounted once
 * per page next to `useClipUrlIngress`.
 */
const ClipSignInAlert: React.FC = () => {
  const _ = useTranslation();
  const { safeAreaInsets } = useThemeStore();
  const [request, setRequest] = useState<ClipSignInRequest | null>(null);
  const requestRef = useRef<ClipSignInRequest | null>(null);

  useEffect(() => {
    const onConfirmRequest = (event: CustomEvent) => {
      // One request at a time — a concurrent clip's request stays
      // unconsumed and resolves to "declined" in the dispatcher.
      if (requestRef.current) return false;
      const detail = event.detail as ClipSignInRequest;
      requestRef.current = detail;
      setRequest(detail);
      return true;
    };
    eventDispatcher.onSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirmRequest);
    return () => {
      eventDispatcher.offSync(CLIP_SIGNIN_CONFIRM_EVENT, onConfirmRequest);
      // Never leave the caller's promise hanging across an unmount
      // (library ↔ reader navigation while the alert is up).
      requestRef.current?.respond(false);
      requestRef.current = null;
    };
  }, []);

  const respond = (ok: boolean) => {
    requestRef.current = null;
    setRequest((current) => {
      current?.respond(ok);
      return null;
    });
  };

  if (!request) return null;

  let host = request.url;
  try {
    host = new URL(request.url).hostname;
  } catch {
    // Keep the raw URL — it still tells the user which page is meant.
  }

  return (
    <div
      className='fixed bottom-0 left-0 right-0 z-50 flex justify-center'
      style={{ paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px` }}
    >
      <Alert
        title={_('Sign in to capture?')}
        message={_(
          'This page on {{host}} looks like a login or verification screen. Open it to sign in, then capture the article manually.',
          { host },
        )}
        confirmLabel={_('Open Page')}
        confirmButtonClassName='btn-contrast'
        onCancel={() => respond(false)}
        onConfirm={() => respond(true)}
      />
    </div>
  );
};

export default ClipSignInAlert;
