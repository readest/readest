import { useEffect, useRef, useState } from 'react';
import { MdClose } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import type { Insets } from '@/types/misc';
import { footerAtBottom } from '../utils/footerBand';
import { getTTSMiniPlayerClearance } from '../utils/ttsMiniPlayerPosition';

const RETURN_TIMEOUT_MS = 15_000;

interface JumpReturnState {
  from?: string;
  to?: string;
  forward: boolean;
}

export default function JumpReturn({
  bookKey,
  gridInsets,
}: {
  bookKey: string;
  gridInsets: Insets;
}) {
  const _ = useTranslation();
  const view = useReaderStore((s) => s.getView(bookKey));
  const viewState = useReaderStore((s) => s.viewStates[bookKey]);
  // An open phone toolbar panel rises over the spot this control takes; the
  // progress panel has its own Go Back and Go Forward.
  const panelOpen = useReaderStore((s) => s.hoveredBookKey === bookKey && !!s.bottomBarTab);
  const [jump, setJump] = useState<JumpReturnState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hide = () => {
    clearTimeout(timer.current);
    setJump(null);
  };
  const show = (next: JumpReturnState) => {
    clearTimeout(timer.current);
    setJump(next);
    timer.current = setTimeout(hide, RETURN_TIMEOUT_MS);
  };

  useEffect(() => {
    if (!view) return;
    setJump(null);
    const onJump = (event: Event) => {
      if (!view.history.canGoBack) return;
      const { from, to } = (event as CustomEvent<Omit<JumpReturnState, 'forward'>>).detail;
      show({ from, to, forward: false });
    };
    view.addEventListener('reader-jump', onJump);
    view.history.addEventListener('index-change', hide);
    return () => {
      view.removeEventListener('reader-jump', onJump);
      view.history.removeEventListener('index-change', hide);
      clearTimeout(timer.current);
    };
  }, [view]);

  if (!view || !jump || viewState?.drawingEnabled || panelOpen) return null;

  const settings = viewState?.viewSettings;
  const footer = settings && footerAtBottom(settings) ? settings.marginBottomPx : 0;
  const player = settings && viewState?.ttsEnabled ? getTTSMiniPlayerClearance(settings, 0) : 0;
  // A chapter name says nothing when the jump stayed in that chapter.
  const chapter = jump.from === jump.to ? undefined : jump.forward ? jump.to : jump.from;
  const label = jump.forward ? _('Go Forward') : _('Go Back');
  const move = () => {
    const history = view.history;
    if (jump.forward ? !history.canGoForward : !history.canGoBack) {
      hide();
      return;
    }
    if (jump.forward) history.forward();
    else history.back();
    show({ ...jump, forward: !jump.forward });
  };

  return (
    <div
      role='group'
      aria-label={_('Navigation History')}
      className='pointer-events-none absolute z-20 flex justify-center px-4'
      style={{
        left: gridInsets.left,
        right: gridInsets.right,
        bottom: gridInsets.bottom / 4 + Math.max(footer, player) + 56,
      }}
    >
      <div className='bg-base-200 eink-bordered pointer-events-auto flex min-w-0 items-center rounded-xl shadow-lg'>
        <button type='button' onClick={move} className='btn btn-ghost min-w-0 px-3'>
          <span className='truncate'>{chapter ? `${label} · ${chapter}` : label}</span>
        </button>
        <button
          type='button'
          aria-label={_('Close')}
          onClick={hide}
          className='btn btn-ghost shrink-0 px-2'
        >
          <MdClose size={18} />
        </button>
      </div>
    </div>
  );
}
