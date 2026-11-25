import clsx from 'clsx';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { type TranslationFunc, useTranslation } from '@/hooks/useTranslation';
import type { GiftCardFace, GiftTier } from '@/types/gift';

export const giftTierName = (tier: GiftTier, _: TranslationFunc) =>
  tier === 'pro' ? _('Pro') : _('Plus');

/** What the composer's preview shows, faintly, in a field not filled in yet. */
export type GiftCardPlaceholders = Pick<GiftCardFace, 'recipientName' | 'senderName' | 'message'>;

/** The cover (plan and year) or the inside cover (names and message). */
export type GiftCardSide = 'front' | 'back';

/**
 * The card is an old cloth-bound book: gilt stamping on the cover, and a
 * bookplate pasted on marbled endpaper inside. It is a printed object, so it
 * keeps its colours in dark themes. Every colour is `not-eink:`; under e-ink
 * the card is paper, ink and 1px rules.
 */
const TIERS: Record<GiftTier, { cloth: string; endpaper: string; ink: string; marble: string[] }> =
  {
    plus: {
      cloth: 'not-eink:bg-[#1f2c4c]',
      endpaper: 'not-eink:bg-[#22304f]',
      ink: 'not-eink:[--gift-ink:#1f3a6b]',
      marble: ['#22304f', '#b8955a', '#e9dcc0', '#2c3d63', '#6d2a33', '#d8c39a', '#1b2640'],
    },
    pro: {
      cloth: 'not-eink:bg-[#4d1823]',
      endpaper: 'not-eink:bg-[#561c27]',
      ink: 'not-eink:[--gift-ink:#6e1f2c]',
      marble: ['#561c27', '#b8955a', '#e9dcc0', '#3a2a35', '#7a2a36', '#d8c39a', '#41222b'],
    },
  };

export const SERIF =
  "'Iowan Old Style', Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif";

// Gold foil: a metallic gradient through the letters, pressed into the cloth.
const GILT =
  'not-eink:bg-[linear-gradient(165deg,#9c7633_0%,#f4dd98_38%,#c69b4b_55%,#f6e3a6_72%,#a77f38_100%)] not-eink:bg-clip-text not-eink:[-webkit-background-clip:text] not-eink:text-transparent not-eink:drop-shadow-[0_0.6px_0_rgb(0_0_0/0.6)]';

// Book cloth: a fine weave under a soft light from above.
const CLOTH: React.CSSProperties = {
  backgroundImage: [
    'radial-gradient(130% 100% at 55% 38%, rgb(255 255 255 / 0.07), transparent 45%, rgb(0 0 0 / 0.5) 100%)',
    'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 3px)',
    'repeating-linear-gradient(90deg, rgb(0 0 0 / 0.14) 0 1px, transparent 1px 3px)',
  ].join(','),
};

// Bands of colour that the turbulence filter combs into marbling.
const marbleBands = (colors: string[]) => {
  const bands: { y: number; height: number; fill: string }[] = [];
  for (let i = 0, y = -40; y < 280; i++) {
    const height = 1.6 + ((i * 7) % 5) * 0.7;
    bands.push({ y, height, fill: colors[i % colors.length]! });
    y += height;
  }
  return bands;
};
const MARBLE_BANDS: Record<GiftTier, ReturnType<typeof marbleBands>> = {
  plus: marbleBands(TIERS.plus.marble),
  pro: marbleBands(TIERS.pro.marble),
};

const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** The year as an old title page prints it. */
export const romanYear = (year: number) => {
  let rest = year;
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
};

// Hebrew, Arabic, Indic, Thai, Tibetan, CJK and Hangul: wide letter-spacing
// breaks joined letters and a synthesized slant reads as a mistake.
const UPRIGHT_SCRIPTS =
  /[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0fff\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

/** Whether text can take the card's italics and spaced capitals. */
export const slantsAndSpaces = (text: string) => !UPRIGHT_SCRIPTS.test(text);

export type GiftMessageSize = 'large' | 'medium' | 'small' | 'xsmall';

// Long messages set smaller. A line break starts a new line however short the
// one before it, so lines count as well as characters: about 40 characters
// fill a line of the largest size.
export const messageSize = (message: string): GiftMessageSize => {
  const lines = message
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0);
  if (lines > 4) return 'small';
  if (lines > 2) return 'medium';
  return 'large';
};

// In card widths, so the bookplate reads the same at every size, but never
// below 11px. `xsmall` is only a fallback: see `step` in GiftCard.
const MESSAGE_SIZES: Record<GiftMessageSize, string> = {
  large: 'text-[max(11px,3.9cqw)]',
  medium: 'text-[max(11px,3.4cqw)]',
  small: 'text-[max(11px,3cqw)]',
  xsmall: 'text-[max(10px,2.7cqw)]',
};
const SIZE_STEPS: GiftMessageSize[] = ['large', 'medium', 'small', 'xsmall'];

// The cover's double rule with a curl in each corner, set off the spine.
const FRAME = (
  <>
    <rect x='40' y='14' width='302' height='198' rx='3' strokeWidth='1.6' />
    <rect x='47' y='21' width='288' height='184' rx='2' strokeWidth='0.7' />
    {(
      [
        [47, 21, 1, 1],
        [335, 21, -1, 1],
        [47, 205, 1, -1],
        [335, 205, -1, -1],
      ] as const
    ).map(([x, y, sx, sy]) => (
      <path
        key={`${x},${y}`}
        strokeWidth='0.9'
        d={`M${x + sx * 4},${y + sy * 14} C${x + sx * 4},${y + sy * 7} ${x + sx * 7},${y + sy * 4} ${x + sx * 14},${y + sy * 4} M${x + sx * 7},${y + sy * 9} a2,2 0 1,0 4,0 a2,2 0 1,0 -4,0`}
      />
    ))}
  </>
);

export const Fleuron = ({ className }: { className?: string }) => (
  <svg aria-hidden='true' viewBox='0 0 80 12' className={className}>
    <g fill='none' stroke='currentColor' strokeWidth='0.8' strokeLinecap='round'>
      <path d='M2 6 H30 M50 6 H78' />
      <path d='M30 6 C34 2 37 2 40 6 C43 2 46 2 50 6 M30 6 C34 10 37 10 40 6 C43 10 46 10 50 6' />
    </g>
    <circle cx='40' cy='6' r='1.3' fill='currentColor' />
  </svg>
);

// One face of the card. The face turned away is hidden outright: WebKit draws
// a face's positioned children through `backface-visibility`. The faces swap
// as the turn passes edge-on, about 100ms into its curve; reduced motion and
// e-ink skip the turn and swap them at once.
const FACE = clsx(
  'absolute inset-0 overflow-hidden rounded-2xl border backface-hidden',
  'bg-base-100 text-base-content eink-bordered',
  'border-black/10 not-eink:shadow-lg theme-dark:border-white/20',
  'transition-[visibility] delay-100 duration-0 aria-hidden:invisible motion-reduce:delay-0 eink:delay-0',
);

interface GiftCardProps {
  face: GiftCardFace;
  placeholders?: GiftCardPlaceholders;
  /** The year printed on the cover and the bookplate; this year by default. */
  year?: number;
  /** The side to show. Without it the card turns over by itself. */
  side?: GiftCardSide;
  onSideChange?: (side: GiftCardSide) => void;
  className?: string;
}

const GiftCard: React.FC<GiftCardProps> = ({
  face,
  placeholders,
  year = new Date().getFullYear(),
  side,
  onSideChange,
  className,
}) => {
  const _ = useTranslation();
  const tier = TIERS[face.tier];
  const ids = useId().replace(/[^\w-]/g, '');
  const goldId = `gift-gold-${ids}`;
  const marbleId = `gift-marble-${ids}`;

  const recipientName = face.recipientName.trim();
  const senderName = face.senderName.trim();
  const message = face.message.trim();
  const shown = {
    recipientName: recipientName || placeholders?.recipientName || '',
    senderName: senderName || placeholders?.senderName || '',
    message: message || placeholders?.message || '',
  };
  const faint = (filled: string) => !filled && 'not-eink:opacity-55';
  // `messageSize` guesses from the length, for the card's own serifs. Where
  // the card falls back to a wider one (Android's serif, measured wider than
  // Georgia), a long message can still need a line more than the bookplate
  // holds; then it steps down a size, for this message, instead of losing its
  // last line to the ellipsis.
  const [step, setStep] = useState({ message: '', by: 0 });
  const by = step.message === shown.message ? step.by : 0;
  const sizeIndex = Math.min(SIZE_STEPS.indexOf(messageSize(shown.message)) + by, 3);
  const size = SIZE_STEPS[sizeIndex]!;
  const roman = romanYear(year);
  const label = _('Gift card');
  const exDono = _('Ex dono');
  const plan = `${giftTierName(face.tier, _)} · ${_('1 year')}`;
  const italic = (text: string) => slantsAndSpaces(text) && 'italic';

  const [ownSide, setOwnSide] = useState<GiftCardSide>('front');
  const current = side ?? ownSide;
  const turn = () => {
    const next = current === 'front' ? 'back' : 'front';
    if (side === undefined) setOwnSide(next);
    onSideChange?.(next);
  };

  // Lift the card off the page while it turns, as a hand would.
  const card = useRef<HTMLDivElement>(null);
  const turned = useRef(current);
  useEffect(() => {
    if (turned.current === current) return;
    turned.current = current;
    const element = card.current;
    const still =
      document.documentElement.getAttribute('data-eink') === 'true' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still || !element?.animate) return;
    element.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.06) translateY(-2%)', offset: 0.35 },
        { transform: 'scale(1)' },
      ],
      { duration: 800, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
    );
  }, [current]);

  // As many whole lines as the bookplate holds at this width, so the message
  // never runs into the signature and its ellipsis shows.
  const messageArea = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<number>();

  // A clamped paragraph still reports its whole height as scrollHeight. Run
  // after the line count settles and on every resize: a narrower card can wrap
  // onto a line more while the count stays the same.
  const fit = useRef(() => {});
  fit.current = () => {
    const text = messageArea.current?.querySelector('p');
    if (!text || lines === undefined || sizeIndex === SIZE_STEPS.length - 1) return;
    if (text.scrollHeight > text.clientHeight + 1) {
      setStep({ message: shown.message, by: by + 1 });
    }
  };

  useLayoutEffect(() => {
    const area = messageArea.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(area).lineHeight);
      if (lineHeight > 0) setLines(Math.max(1, Math.floor(area.clientHeight / lineHeight)));
      fit.current();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [size]);

  useLayoutEffect(() => fit.current(), [lines, sizeIndex, by, shown.message]);

  return (
    <div
      ref={card}
      data-tier={face.tier}
      data-side={current}
      style={{ fontFamily: SERIF }}
      className={clsx(
        '@container relative aspect-[1.586/1] w-full perspective-[1400px]',
        className,
      )}
    >
      <div
        className={clsx(
          'absolute inset-0 transform-3d transition-transform duration-[800ms] ease-[cubic-bezier(0.3,1.3,0.45,1)]',
          'motion-reduce:transform-none motion-reduce:transition-none eink:transform-none eink:transition-none',
          current === 'back' && 'rotate-y-180',
        )}
      >
        {/* The cover. */}
        <div
          data-face='front'
          aria-hidden={current !== 'front'}
          className={clsx(FACE, tier.cloth, 'not-eink:text-[#e9cf86]')}
        >
          <div aria-hidden='true' className='eink:hidden absolute inset-0' style={CLOTH} />
          {/* The spine's hinge, on the side a book in this language opens from. */}
          <div
            aria-hidden='true'
            className={clsx(
              'eink:hidden absolute inset-y-0 start-0 w-[6.5%]',
              'bg-[linear-gradient(90deg,rgb(0_0_0/0.42),rgb(0_0_0/0.12)_62%,rgb(255_255_255/0.08)_78%,rgb(0_0_0/0.3)_92%,transparent)]',
              'rtl:bg-[linear-gradient(270deg,rgb(0_0_0/0.42),rgb(0_0_0/0.12)_62%,rgb(255_255_255/0.08)_78%,rgb(0_0_0/0.3)_92%,transparent)]',
            )}
          />
          {/* E-ink keeps the hinge as a rule, so the frame still reads as set off a spine. */}
          <div
            aria-hidden='true'
            className='not-eink:hidden border-base-content absolute inset-y-0 start-[6.5%] border-s'
          />
          <svg
            aria-hidden='true'
            viewBox='0 0 360 227'
            className='absolute inset-0 size-full rtl:-scale-x-100'
          >
            <defs>
              <linearGradient id={goldId} x1='0' y1='0' x2='1' y2='1'>
                <stop offset='0' stopColor='#9c7633' />
                <stop offset='0.38' stopColor='#f4dd98' />
                <stop offset='0.55' stopColor='#c69b4b' />
                <stop offset='0.72' stopColor='#f6e3a6' />
                <stop offset='1' stopColor='#a77f38' />
              </linearGradient>
            </defs>
            <g fill='none' stroke={`url(#${goldId})`} className='eink:hidden'>
              {FRAME}
            </g>
            <g fill='none' stroke='currentColor' className='not-eink:hidden'>
              {FRAME}
            </g>
          </svg>

          <div className='absolute inset-0 flex flex-col items-center justify-center ps-[6.5%] text-center'>
            {/* The Readest icon, set on the cloth like a pasted cover picture. Its
                transparent margin is taken back so the cover keeps its height. */}
            <Image
              src='/icon.png'
              alt=''
              width={64}
              height={64}
              className='-mt-[1.7cqw] mb-[0.8cqw] h-auto w-[13cqw] eink:grayscale not-eink:drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.55)]'
            />
            <span
              className={clsx(
                'mb-[1.2cqw] leading-tight',
                // Scripts without capitals lose the spacing, so they get the size instead.
                slantsAndSpaces(label)
                  ? 'text-[max(8px,2.9cqw)] uppercase tracking-[0.34em]'
                  : 'text-[max(10px,3.4cqw)]',
                GILT,
              )}
            >
              {label}
            </span>
            <span
              className={clsx(
                'ms-[0.16em] text-[10cqw] font-semibold uppercase leading-none tracking-[0.16em]',
                GILT,
              )}
            >
              Readest
            </span>
            <Fleuron className='mb-[1.2cqw] mt-[1.6cqw] h-auto w-[24cqw] not-eink:text-[#d9bd72]' />
            <span className={clsx('text-[max(12px,4.4cqw)] leading-tight', italic(plan), GILT)}>
              <span>{giftTierName(face.tier, _)}</span>
              {' · '}
              <span>{_('1 year')}</span>
            </span>
          </div>
          <span
            aria-hidden='true'
            className={clsx(
              'absolute inset-x-0 bottom-[12.5%] ps-[6.5%] text-center text-[max(7px,2.6cqw)] tracking-[0.3em]',
              GILT,
            )}
          >
            {roman}
          </span>
        </div>

        {/* The inside cover: a bookplate on marbled endpaper. */}
        <div
          data-face='back'
          aria-hidden={current !== 'back'}
          className={clsx(
            FACE,
            tier.endpaper,
            tier.ink,
            'eink:[--gift-ink:currentColor] rotate-y-180 motion-reduce:transform-none eink:transform-none',
          )}
        >
          <svg
            aria-hidden='true'
            viewBox='0 0 360 227'
            preserveAspectRatio='xMidYMid slice'
            className='eink:hidden absolute inset-0 size-full'
          >
            <defs>
              <filter id={marbleId} x='0' y='0' width='100%' height='100%'>
                <feTurbulence
                  type='fractalNoise'
                  baseFrequency='0.014 0.05'
                  numOctaves={3}
                  seed={11}
                  result='noise'
                />
                <feDisplacementMap
                  in='SourceGraphic'
                  in2='noise'
                  scale={46}
                  xChannelSelector='R'
                  yChannelSelector='G'
                />
              </filter>
            </defs>
            <g filter={`url(#${marbleId})`}>
              {MARBLE_BANDS[face.tier].map(({ y, height, fill }) => (
                <rect key={y} x='-40' y={y} width='440' height={height} fill={fill} />
              ))}
            </g>
          </svg>
          <div
            aria-hidden='true'
            className='eink:hidden absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_50%,transparent_55%,rgb(0_0_0/0.35))]'
          />

          <div
            data-plate
            className={clsx(
              'absolute inset-x-[6.5%] inset-y-[7%] flex flex-col rounded-[2px]',
              'bg-base-100 text-base-content not-eink:bg-[#f4ecd8] not-eink:text-[#2b2116]',
              'not-eink:shadow-[0_1px_1px_rgb(0_0_0/0.35),0_3px_10px_rgb(0_0_0/0.35)]',
              'px-[6cqw] pb-[3.6cqw] pt-[5.6cqw]',
            )}
          >
            <div
              aria-hidden='true'
              className='pointer-events-none absolute inset-[2cqw] border border-(--gift-ink) opacity-75'
            />
            <div
              aria-hidden='true'
              className='pointer-events-none absolute inset-[3cqw] border-[0.5px] border-(--gift-ink) opacity-75'
            />
            <span className='absolute inset-x-0 top-[2cqw] -translate-y-1/2 text-center leading-none'>
              <span
                className={clsx(
                  'bg-base-100 px-[1.6cqw] text-(--gift-ink) not-eink:bg-[#f4ecd8]',
                  slantsAndSpaces(exDono)
                    ? 'text-[max(7px,2.5cqw)] uppercase tracking-[0.36em]'
                    : 'text-[max(9px,3cqw)]',
                )}
              >
                {exDono}
              </span>
            </span>

            {shown.recipientName && (
              <p className='flex min-w-0 items-baseline gap-[1.2cqw] text-[max(11px,3.4cqw)] leading-snug'>
                <span className={clsx('shrink-0 text-(--gift-ink)', italic(_('To')))}>
                  {_('To')}
                </span>
                <span
                  dir='auto'
                  className={clsx('truncate', italic(shown.recipientName), faint(recipientName))}
                >
                  {shown.recipientName}
                </span>
              </p>
            )}

            <div
              ref={messageArea}
              className={clsx(
                'mt-[1cqw] min-h-0 flex-1 overflow-hidden leading-[1.38]',
                MESSAGE_SIZES[size],
              )}
            >
              {shown.message && (
                <p
                  dir='auto'
                  style={{ '--gift-lines': lines } as React.CSSProperties}
                  className={clsx(
                    'line-clamp-(--gift-lines) whitespace-pre-line break-words',
                    italic(shown.message),
                    faint(message),
                  )}
                >
                  {shown.message}
                </p>
              )}
            </div>

            <div className='mt-[0.6cqw] flex items-baseline justify-between gap-[3cqw]'>
              <span
                aria-hidden='true'
                className='shrink-0 text-[max(7px,2.2cqw)] uppercase tracking-[0.22em] text-(--gift-ink) not-eink:opacity-80'
              >
                {`Readest · ${roman}`}
              </span>
              {shown.senderName && (
                <span className='flex min-w-0 items-baseline gap-[1cqw] text-[max(11px,3.4cqw)]'>
                  <span aria-hidden='true'>—</span>
                  <span
                    dir='auto'
                    className={clsx('truncate', italic(shown.senderName), faint(senderName))}
                  >
                    {shown.senderName}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        type='button'
        aria-label={_('Turn over')}
        onClick={turn}
        className='absolute inset-0 z-10 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2'
      />
    </div>
  );
};

export default GiftCard;
