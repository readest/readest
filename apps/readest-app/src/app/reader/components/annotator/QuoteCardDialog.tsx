import clsx from 'clsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { makeSafeFilename } from '@/utils/misc';
import { canShareText } from '@/utils/share';
import {
  QUOTE_CARD_COLORS,
  type QuoteCardColors,
  type QuoteCardColorsId,
  type QuoteCardFont,
  type QuoteCardLayoutId,
  type QuoteCardShape,
} from '@/utils/quoteCard';
import {
  quoteCardToPng,
  renderQuoteCard,
  type QuoteCardContent,
  type QuoteCardStyle,
} from '@/utils/quoteCardRenderer';
import { BoxedList, SettingsSwitchRow } from '@/components/settings/primitives';
import SegmentedControl from '@/components/SegmentedControl';
import Dialog from '@/components/Dialog';

interface QuoteCardDialogProps {
  isOpen: boolean;
  content: QuoteCardContent;
  // Colors of the reading theme, for the "Reader Theme" swatch.
  readerColors: QuoteCardColors;
  // The reader's serif and sans-serif chains from the font settings.
  fontFamilies: Record<QuoteCardFont, string>;
  defaultFont: QuoteCardFont;
  onClose: () => void;
}

const COLOR_IDS: QuoteCardColorsId[] = ['paper', 'night', 'sepia', 'reader'];

const QuoteCardDialog: React.FC<QuoteCardDialogProps> = ({
  isOpen,
  content,
  readerColors,
  fontFamilies,
  defaultFont,
  onClose,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<QuoteCardLayoutId>('classic');
  const [colorsId, setColorsId] = useState<QuoteCardColorsId>('paper');
  const [font, setFont] = useState<QuoteCardFont>(defaultFont);
  const [shape, setShape] = useState<QuoteCardShape>('fit');
  const [showBookInfo, setShowBookInfo] = useState(true);
  const [showQr, setShowQr] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);

  const colorsFor = (id: QuoteCardColorsId) =>
    id === 'reader' ? readerColors : QUOTE_CARD_COLORS[id];
  const colorLabels: Record<QuoteCardColorsId, string> = {
    paper: _('Paper'),
    night: _('Night'),
    sepia: _('Sepia'),
    reader: _('Reader Theme'),
  };

  const style = useMemo<QuoteCardStyle>(
    () => ({
      layout,
      colors: colorsId === 'reader' ? readerColors : QUOTE_CARD_COLORS[colorsId],
      fontFamily: fontFamilies[font],
      shape,
      showBookInfo,
      showQr,
    }),
    [layout, colorsId, readerColors, fontFamilies, font, shape, showBookInfo, showQr],
  );

  // The brand stays untranslated inside the localized signature.
  const signature = _('via {{app}}', { app: 'Readest' });
  const card = useMemo(() => ({ ...content, brand: signature }), [content, signature]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!isOpen || !canvas) return;
    let stale = false;
    renderQuoteCard(canvas, card, style)
      .then(({ truncated }) => {
        if (!stale) setTruncated(truncated);
      })
      .catch((error) => console.error('Failed to render quote card:', error));
    return () => {
      stale = true;
    };
  }, [isOpen, card, style]);

  const filename = `${makeSafeFilename(content.title || 'Readest')}-quote.png`;
  const mimeType = 'image/png';
  const getBytes = async () => (await quoteCardToPng(canvasRef.current!)).arrayBuffer();
  const toast = (type: 'info' | 'error', message: string) =>
    eventDispatcher.dispatch('toast', { type, message });

  // The PNG is handed over as a promise so the write starts inside the click:
  // WebKit refuses clipboard writes once the user gesture has passed.
  const handleCopy = () => {
    navigator.clipboard
      .write([new ClipboardItem({ [mimeType]: quoteCardToPng(canvasRef.current!) })])
      .then(() => toast('info', _('Copied to clipboard')))
      .catch((error) => {
        console.error('Failed to copy quote card:', error);
        toast('error', _('Failed to copy the image'));
      });
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const bytes = await getBytes();
      // Some Android builds (HarmonyOS) refuse the gallery insert; those save a file.
      if (
        appService?.isAndroidApp &&
        (await appService.saveImageToGallery(filename, bytes, mimeType))
      ) {
        toast('info', _('Image saved to gallery'));
        return;
      }
      const saved = await appService?.saveFile(filename, bytes, { mimeType });
      toast(
        saved ? 'info' : 'error',
        saved ? _('Image saved successfully') : _('Failed to save the image'),
      );
    } catch (error) {
      console.error('Failed to save quote card:', error);
      toast('error', _('Failed to save the image'));
    } finally {
      setBusy(false);
    }
  };

  // The share sheet gives its own feedback, a dismissed one included; false
  // means the image never reached it.
  const handleShare = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Anchor the macOS / iPad share sheet above the button.
    const rect = e.currentTarget.getBoundingClientRect();
    const sharePosition = {
      x: rect.left + rect.width / 2,
      y: rect.top,
      preferredEdge: 'bottom' as const,
    };
    setBusy(true);
    let shared: boolean | undefined = false;
    try {
      shared = await appService?.saveFile(filename, await getBytes(), {
        mimeType,
        share: true,
        sharePosition,
      });
    } catch (error) {
      console.error('Failed to share quote card:', error);
    } finally {
      setBusy(false);
    }
    if (shared === false) toast('error', _('Failed to share the image'));
  };

  const canShare = canShareText(appService);
  const canCopy = !appService?.isAndroidApp && typeof ClipboardItem !== 'undefined';

  return (
    <Dialog
      isOpen={isOpen}
      title={_('Quote Card')}
      onClose={onClose}
      boxClassName='sm:w-[90%]! sm:h-auto sm:max-h-[90vh]! sm:max-w-4xl!'
    >
      <div className='flex flex-col gap-4 pb-2 sm:flex-row sm:items-start'>
        <div className='bg-base-200 flex flex-col items-center gap-2 rounded-lg p-3 sm:flex-1'>
          <canvas
            ref={canvasRef}
            className='eink-bordered h-auto max-h-[40vh] w-auto max-w-full rounded shadow-md sm:max-h-[65vh]'
          />
          {truncated && (
            <p className='text-base-content/70 text-center text-xs'>
              {_('The quote was shortened to fit the card.')}
            </p>
          )}
        </div>

        <div className='flex flex-col gap-4 sm:w-80'>
          <div className='flex flex-col gap-2'>
            <span className='text-sm font-medium'>{_('Layout')}</span>
            <SegmentedControl<QuoteCardLayoutId>
              fullWidth
              ariaLabel={_('Layout')}
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'classic', label: _('Classic') },
                { value: 'centered', label: _('Centered') },
                { value: 'cover', label: _('Cover') },
                { value: 'page', label: _('Page') },
              ]}
            />
          </div>

          <div className='flex flex-col gap-2'>
            <span className='text-sm font-medium'>{_('Colors')}</span>
            <div className='flex gap-3'>
              {COLOR_IDS.map((id) => {
                const colors = colorsFor(id);
                return (
                  <button
                    key={id}
                    type='button'
                    title={colorLabels[id]}
                    aria-label={colorLabels[id]}
                    aria-pressed={colorsId === id}
                    onClick={() => setColorsId(id)}
                    className={clsx(
                      'eink-bordered flex h-10 w-10 items-center justify-center rounded-full border font-serif text-sm',
                      colorsId === id
                        ? 'border-base-content ring-base-content ring-2 ring-offset-2 ring-offset-base-100'
                        : 'border-base-content/20',
                    )}
                    style={{ backgroundColor: colors.bg, color: colors.fg }}
                  >
                    Aa
                  </button>
                );
              })}
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            <span className='text-sm font-medium'>{_('Font')}</span>
            <SegmentedControl<QuoteCardFont>
              fullWidth
              ariaLabel={_('Font')}
              value={font}
              onChange={setFont}
              options={[
                { value: 'serif', label: _('Serif') },
                { value: 'sans', label: _('Sans') },
              ]}
            />
          </div>

          <div className='flex flex-col gap-2'>
            <span className='text-sm font-medium'>{_('Shape')}</span>
            <SegmentedControl<QuoteCardShape>
              fullWidth
              ariaLabel={_('Shape')}
              value={shape}
              onChange={setShape}
              options={[
                { value: 'fit', label: _('Fit') },
                { value: 'portrait', label: '4:5' },
                { value: 'square', label: '1:1' },
                { value: 'wide', label: '16:9' },
              ]}
            />
          </div>

          <BoxedList>
            <SettingsSwitchRow
              label={_('Book Info')}
              checked={showBookInfo}
              onChange={() => setShowBookInfo((value) => !value)}
            />
            {content.qrUrl && (
              <SettingsSwitchRow
                label={_('QR Code')}
                description={_('Links to this passage in Readest')}
                checked={showQr}
                onChange={() => setShowQr((value) => !value)}
              />
            )}
          </BoxedList>

          <div className='flex flex-wrap justify-end gap-2'>
            {canCopy && (
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                disabled={busy}
                onClick={handleCopy}
              >
                {_('Copy Image')}
              </button>
            )}
            <button
              type='button'
              className={clsx('btn btn-sm', canShare ? 'btn-ghost eink-bordered' : 'btn-contrast')}
              disabled={busy}
              onClick={handleSave}
            >
              {_('Save Image')}
            </button>
            {canShare && (
              <button
                type='button'
                className='btn btn-contrast btn-sm'
                disabled={busy}
                onClick={handleShare}
              >
                {_('Share')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default QuoteCardDialog;
