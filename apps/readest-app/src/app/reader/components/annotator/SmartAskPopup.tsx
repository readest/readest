import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiCaretDown, PiCaretUp } from 'react-icons/pi';

import Popup from '@/components/Popup';
import { Position, TextSelection } from '@/utils/sel';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { getLocale } from '@/utils/misc';
import { DEFAULT_SMART_ASK_SETTINGS } from '@/services/smartAsk/types';
import { extractContext } from '@/services/smartAsk/contextExtractor';
import { streamSmartAsk, SMART_ASK_SEPARATOR } from '@/services/smartAsk/client';

interface SmartAskPopupProps {
  selection: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
}

interface Insight {
  label: string;
  content: string;
}

function parseSection(text: string): Insight[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => {
      const m = l.match(/^\[([^\]]+)\]\s+(.+)/);
      return m ? [{ label: m[1]!, content: m[2]! }] : [];
    });
}

const InsightItem: React.FC<{ brief: Insight; detail?: string }> = ({ brief, detail }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className='border-base-content/10 rounded border p-2'>
      <p className='text-base-content/80 select-text text-xs leading-relaxed'>
        <span className='text-base-content mr-1 font-semibold'>[{brief.label}]</span>
        {expanded && detail ? detail : brief.content}
      </p>
      {detail && (
        <button
          type='button'
          className='text-base-content/50 mt-1 flex items-center gap-0.5 text-[10px] hover:underline'
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <PiCaretUp className='size-3' /> Less
            </>
          ) : (
            <>
              <PiCaretDown className='size-3' /> More
            </>
          )}
        </button>
      )}
    </div>
  );
};

const SmartAskPopup: React.FC<SmartAskPopupProps> = ({
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const smartAskSettings = settings?.smartAskSettings ?? DEFAULT_SMART_ASK_SETTINGS;

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  const sepIdx = text.indexOf(SMART_ASK_SEPARATOR);
  const briefRaw = sepIdx >= 0 ? text.slice(0, sepIdx) : text;
  const detailRaw = sepIdx >= 0 ? text.slice(sepIdx + SMART_ASK_SEPARATOR.length) : '';
  const briefItems = parseSection(briefRaw);
  const detailItems = parseSection(detailRaw);
  const detailMap = Object.fromEntries(detailItems.map((d) => [d.label, d.content]));

  const run = useCallback(async () => {
    if (!smartAskSettings.enabled || !smartAskSettings.model) return;

    abortRef.current = new AbortController();
    setLoading(true);
    setError('');
    setText('');

    const context = extractContext(selection, smartAskSettings.maxContextChars);
    const lang = getLocale();

    try {
      for await (const delta of streamSmartAsk(
        selection.text,
        context,
        smartAskSettings,
        lang,
        abortRef.current.signal,
      )) {
        setText((prev) => prev + delta);
        setLoading(false);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message || _('Failed to get AI response'));
        setLoading(false);
      }
    }
  }, [selection, smartAskSettings, _]);

  useEffect(() => {
    run();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPreview =
    selection.text.length > 60 ? `${selection.text.slice(0, 60)}…` : selection.text;

  return (
    <div>
      <Popup
        width={popupWidth}
        height={popupHeight}
        position={position}
        trianglePosition={trianglePosition}
        className='select-text'
        onDismiss={onDismiss}
      >
        <div className='text-base-content flex h-full flex-col gap-2 p-3'>
          <p className='text-base-content/50 truncate text-[11px] italic'>
            &ldquo;{selectedPreview}&rdquo;
          </p>

          {!smartAskSettings.enabled ? (
            <p className='text-base-content/60 text-xs'>{_('Enable SmartAsk in Settings')}</p>
          ) : !smartAskSettings.model ? (
            <p className='text-base-content/60 text-xs'>{_('SmartAsk model not configured')}</p>
          ) : error ? (
            <p className='text-error text-xs'>{error}</p>
          ) : (
            <div className='flex flex-col gap-2 overflow-y-auto'>
              {loading && briefItems.length === 0 && (
                <div className='flex items-center gap-2 text-xs'>
                  <div className='border-primary size-4 animate-spin rounded-full border-2 border-t-transparent' />
                  {_('Analyzing...')}
                </div>
              )}
              {briefItems.map((brief) => (
                <InsightItem key={brief.label} brief={brief} detail={detailMap[brief.label]} />
              ))}
            </div>
          )}
        </div>
      </Popup>
    </div>
  );
};

export default SmartAskPopup;
