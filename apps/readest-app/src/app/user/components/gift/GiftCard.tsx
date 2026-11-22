import clsx from 'clsx';
import Image from 'next/image';
import { useLayoutEffect, useRef, useState } from 'react';
import { type TranslationFunc, useTranslation } from '@/hooks/useTranslation';
import type { GiftCardFace, GiftTier } from '@/types/gift';

export const giftTierName = (tier: GiftTier, _: TranslationFunc) =>
  tier === 'pro' ? _('Pro') : _('Plus');

/** What the composer's preview shows, faintly, in a field not filled in yet. */
export type GiftCardPlaceholders = Pick<GiftCardFace, 'recipientName' | 'senderName' | 'message'>;

/**
 * Each tier's palette, from the plan accents' sky and violet families. The card
 * is a printed object, so it keeps these in dark themes too. Ink is tier-950
 * and secondary ink tier-900: both pass WCAG AA on the darker gradient stop.
 * Every colour is `not-eink:`; under e-ink the card is paper, ink and a 1px
 * border, and the ribbon is an outline.
 */
const TIER_STYLES: Record<GiftTier, { card: string; ink: string; muted: string; accent: string }> =
  {
    plus: {
      card: 'border-sky-900/10 not-eink:from-sky-100 not-eink:to-sky-300 not-eink:shadow-sky-900/20',
      ink: 'not-eink:text-sky-950',
      muted: 'not-eink:text-sky-900',
      accent: 'not-eink:text-sky-700',
    },
    pro: {
      card: 'border-violet-900/10 not-eink:from-violet-100 not-eink:to-violet-300 not-eink:shadow-violet-900/20',
      ink: 'not-eink:text-violet-950',
      muted: 'not-eink:text-violet-900',
      accent: 'not-eink:text-violet-700',
    },
  };

// Long messages set smaller. A line break starts a new line however short the
// one before it, so lines count as well as characters: about 40 characters
// fill a line of the largest size on a phone-width card.
export const messageSize = (message: string) => {
  const lines = message
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0);
  if (lines > 4) return 'text-xs';
  if (lines > 2) return 'text-sm';
  return 'text-base';
};

// `leading-snug`, in em so the ruled lines below match the message's lines.
const LEADING = 1.375;
const RULED_LINES: React.CSSProperties = {
  backgroundImage: `linear-gradient(to bottom, transparent calc(${LEADING}em - 1px), var(--gift-rule, transparent) 0)`,
  backgroundSize: `100% ${LEADING}em`,
};

// A bookmark ribbon hanging from the top edge. It sits at the card's end
// padding and stops beside the title, in the room the top rows reserve with
// `pe-8`. E-ink draws it as an outline left open at the top, where the card's
// border already runs, with the sides inset half a stroke so neither is clipped.
const Ribbon = ({ className }: { className?: string }) => (
  <svg
    aria-hidden='true'
    viewBox='0 0 20 64'
    className={clsx(
      'pointer-events-none absolute end-4 top-0 h-16 w-5 overflow-visible',
      className,
    )}
  >
    <path d='M0 0H20V64L10 54L0 64Z' className='eink:hidden fill-current' />
    {/* Satin sheen down the leading half, colour only. */}
    <path d='M0 0H8V56L0 64Z' className='eink:hidden fill-white/20' />
    <path
      d='M0.5 0V63L10 53.5L19.5 63V0'
      fill='none'
      strokeWidth={1}
      className='not-eink:hidden stroke-base-content'
    />
  </svg>
);

interface GiftCardProps {
  face: GiftCardFace;
  placeholders?: GiftCardPlaceholders;
  className?: string;
}

const GiftCard: React.FC<GiftCardProps> = ({ face, placeholders, className }) => {
  const _ = useTranslation();
  const tier = TIER_STYLES[face.tier];
  const recipientName = face.recipientName.trim();
  const senderName = face.senderName.trim();
  const message = face.message.trim();
  const shown = {
    recipientName: recipientName || placeholders?.recipientName || '',
    senderName: senderName || placeholders?.senderName || '',
    message: message || placeholders?.message || '',
  };
  const faint = (filled: string) => !filled && 'not-eink:opacity-55';
  const size = messageSize(shown.message);
  const nameLabel = clsx(
    'shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.12em]',
    tier.muted,
  );

  // As many whole lines as the ruled middle holds at this width, so the
  // message never runs under the title or the names and its ellipsis shows.
  const messageArea = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<number>();
  useLayoutEffect(() => {
    const area = messageArea.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(area).lineHeight);
      if (lineHeight > 0) setLines(Math.max(1, Math.floor(area.clientHeight / lineHeight)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [size]);

  return (
    <div
      data-tier={face.tier}
      className={clsx(
        '@container relative isolate flex aspect-[1.586/1] w-full flex-col overflow-hidden rounded-2xl border bg-clip-padding p-4',
        'bg-base-100 text-base-content eink-bordered',
        'not-eink:bg-linear-to-br not-eink:shadow-lg',
        // A hairline rim over the page keeps the light card apart from a dark one.
        'theme-dark:border-white/30',
        tier.card,
        tier.ink,
        className,
      )}
    >
      <Ribbon className={tier.accent} />

      <div className='flex items-center justify-between gap-3 pe-8'>
        <span className='flex min-w-0 items-center gap-1.5'>
          <Image
            src='/icon.png'
            alt=''
            width={20}
            height={20}
            className='eink:grayscale size-5 shrink-0'
          />
          <span className='truncate text-sm font-semibold tracking-tight'>Readest</span>
        </span>
        <span
          className={clsx(
            'shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.16em]',
            tier.muted,
          )}
        >
          {_('Gift card')}
        </span>
      </div>

      <p className='mt-1 flex flex-wrap items-baseline gap-x-2 pe-8 leading-tight'>
        <span className='text-xl font-semibold leading-tight tracking-tight'>
          {_('Readest {{plan}}', { plan: giftTierName(face.tier, _) })}
        </span>
        <span aria-hidden='true' className={tier.muted}>
          ·
        </span>
        <span className={clsx('text-sm font-medium leading-tight', tier.muted)}>{_('1 year')}</span>
      </p>

      {/* The ruled writing area: a rule under every line, none in e-ink. The
          narrowest cards set every message small. */}
      <div
        ref={messageArea}
        style={RULED_LINES}
        className={clsx(
          'mb-0.5 mt-2 min-h-0 flex-1 overflow-hidden font-serif leading-snug',
          'not-eink:[--gift-rule:color-mix(in_srgb,currentColor_14%,transparent)]',
          size,
          '@max-[16rem]:text-xs',
        )}
      >
        {shown.message && (
          <p
            dir='auto'
            style={{ '--gift-lines': lines } as React.CSSProperties}
            className={clsx(
              'line-clamp-(--gift-lines) whitespace-pre-line break-words italic [&:dir(rtl)]:not-italic',
              faint(message),
            )}
          >
            {shown.message}
          </p>
        )}
      </div>

      {(shown.recipientName || shown.senderName) && (
        <div className='flex items-baseline justify-between gap-4'>
          {shown.recipientName ? (
            <span className='flex min-w-0 items-baseline gap-1.5'>
              <span className={nameLabel}>{_('To')}</span>
              <span
                dir='auto'
                className={clsx('truncate text-sm font-medium', faint(recipientName))}
              >
                {shown.recipientName}
              </span>
            </span>
          ) : (
            <span />
          )}
          {shown.senderName && (
            <span className='flex min-w-0 items-baseline gap-1.5'>
              <span className={nameLabel}>{_('From')}</span>
              <span dir='auto' className={clsx('truncate text-sm font-medium', faint(senderName))}>
                {shown.senderName}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default GiftCard;
