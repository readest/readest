import clsx from 'clsx';
import { PiBookOpenTextFill } from 'react-icons/pi';
import { type TranslationFunc, useTranslation } from '@/hooks/useTranslation';
import type { GiftCardFace, GiftTier } from '@/types/gift';

export const giftTierName = (tier: GiftTier, _: TranslationFunc) =>
  tier === 'pro' ? _('Pro') : _('Plus');

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

// Long messages set smaller so all 300 characters fit on a phone-width card.
const messageSize = (length: number) => {
  if (length > 200) return 'text-xs line-clamp-6';
  if (length > 100) return 'text-sm line-clamp-4';
  return 'text-base line-clamp-3';
};

// A bookmark ribbon hanging from the top edge. It sits at the card's end
// padding and stops above the message, beside the rows that reserve `pe-8`.
const Ribbon = ({ className }: { className?: string }) => (
  <svg
    aria-hidden='true'
    viewBox='0 0 20 64'
    className={clsx('pointer-events-none absolute top-0 end-4 h-16 w-5 sm:end-5', className)}
  >
    <path
      d='M0 0H20V64L10 54L0 64Z'
      strokeWidth={1.25}
      className='fill-base-100 stroke-base-content not-eink:fill-current not-eink:stroke-none'
    />
    {/* Satin sheen down the leading half, colour only. */}
    <path d='M0 0H8V56L0 64Z' className='eink:hidden fill-white/20' />
  </svg>
);

interface GiftCardProps {
  face: GiftCardFace;
  className?: string;
}

const GiftCard: React.FC<GiftCardProps> = ({ face, className }) => {
  const _ = useTranslation();
  const tier = TIER_STYLES[face.tier];
  const recipientName = face.recipientName.trim();
  const senderName = face.senderName.trim();
  const message = face.message.trim();
  const nameLabel = clsx(
    'shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.12em]',
    tier.muted,
  );

  return (
    <div
      data-tier={face.tier}
      className={clsx(
        'relative isolate flex aspect-[1.586/1] w-full flex-col overflow-hidden rounded-2xl border p-4 sm:p-5',
        'bg-base-100 text-base-content eink-bordered',
        'not-eink:bg-linear-to-br not-eink:shadow-lg',
        // A hairline rim keeps the light card apart from a dark page.
        'theme-dark:border-white/25',
        tier.card,
        tier.ink,
        className,
      )}
    >
      {/* Faint ruled page behind the writing. */}
      <div
        aria-hidden='true'
        className={clsx(
          'eink:hidden pointer-events-none absolute inset-0 -z-10 opacity-10',
          tier.muted,
        )}
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, transparent 0 21px, currentColor 21px 22px)',
        }}
      />
      <Ribbon className={tier.accent} />

      <div className='flex items-center justify-between gap-3 pe-8'>
        <span className='flex min-w-0 items-center gap-1.5'>
          <PiBookOpenTextFill
            aria-hidden='true'
            className={clsx('h-4 w-4 shrink-0', tier.accent)}
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

      <p className='mt-1.5 flex flex-wrap items-baseline gap-x-2 pe-8 leading-tight'>
        <span className='text-xl font-semibold tracking-tight'>
          {_('Readest {{plan}}', { plan: giftTierName(face.tier, _) })}
        </span>
        <span aria-hidden='true' className={tier.muted}>
          ·
        </span>
        <span className={clsx('text-sm font-medium', tier.muted)}>{_('1 year')}</span>
      </p>

      <div className='flex min-h-0 flex-1 items-center py-1.5'>
        {message && (
          <p
            dir='auto'
            className={clsx(
              'w-full whitespace-pre-line break-words font-serif italic leading-snug',
              messageSize(message.length),
            )}
          >
            {message}
          </p>
        )}
      </div>

      {(recipientName || senderName) && (
        <div className='flex items-baseline justify-between gap-4'>
          {recipientName ? (
            <span className='flex min-w-0 items-baseline gap-1.5'>
              <span className={nameLabel}>{_('To')}</span>
              <span dir='auto' className='truncate text-sm font-medium'>
                {recipientName}
              </span>
            </span>
          ) : (
            <span />
          )}
          {senderName && (
            <span className='flex min-w-0 items-baseline gap-1.5'>
              <span className={nameLabel}>{_('From')}</span>
              <span dir='auto' className='truncate text-sm font-medium'>
                {senderName}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default GiftCard;
