import clsx from 'clsx';
import { useId, useState } from 'react';
import { IoCheckmark } from 'react-icons/io5';
import { type TranslationFunc, useTranslation } from '@/hooks/useTranslation';
import {
  BoxedList,
  SettingLabel,
  SettingsInput,
  SettingsRow,
} from '@/components/settings/primitives';
import { getLocale } from '@/utils/misc';
import {
  GIFT_MESSAGE_MAX,
  GIFT_NAME_MAX,
  type GiftDraftInput,
  type GiftPrice,
  type GiftTier,
} from '@/types/gift';
import { getPlanAccent, getPlanDetails } from '../../utils/plan';
import GiftCard, { type GiftCardPlaceholders, type GiftCardSide, giftTierName } from './GiftCard';

export type GiftFaceText = Pick<GiftDraftInput, 'recipientName' | 'senderName' | 'message'>;

const TIERS: GiftTier[] = ['plus', 'pro'];

const facePlaceholders = (_: TranslationFunc): GiftCardPlaceholders => ({
  recipientName: _('Their name'),
  senderName: _('Your name'),
  message: _('Write a few words for them'),
});

const formatPrice = ({ price, currency }: GiftPrice) =>
  new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(price / 100);

/** To, From and Message, shared by the composer and the Sent card editor. */
export const GiftFaceFields: React.FC<{
  value: GiftFaceText;
  onChange: (value: GiftFaceText) => void;
}> = ({ value, onChange }) => {
  const _ = useTranslation();
  const messageId = useId();
  const placeholders = facePlaceholders(_);
  // Programmatic and pasted input skip `maxLength`, so cut here too.
  const update =
    (key: keyof GiftFaceText, max: number) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...value, [key]: event.target.value.slice(0, max) });

  return (
    <BoxedList>
      <SettingsRow label={_('To')}>
        <SettingsInput
          aria-label={_('To')}
          value={value.recipientName}
          maxLength={GIFT_NAME_MAX}
          placeholder={placeholders.recipientName}
          onChange={update('recipientName', GIFT_NAME_MAX)}
        />
      </SettingsRow>
      <SettingsRow label={_('From')}>
        <SettingsInput
          aria-label={_('From')}
          value={value.senderName}
          maxLength={GIFT_NAME_MAX}
          placeholder={placeholders.senderName}
          onChange={update('senderName', GIFT_NAME_MAX)}
        />
      </SettingsRow>
      <div className='flex flex-col gap-1 py-3 pe-4'>
        <div className='flex items-baseline justify-between gap-3'>
          <SettingLabel as='label' htmlFor={messageId}>
            {_('Message')}
          </SettingLabel>
          <span dir='ltr' className='text-base-content/65 text-[0.8em] tabular-nums'>
            {`${value.message.length} / ${GIFT_MESSAGE_MAX}`}
          </span>
        </div>
        <textarea
          id={messageId}
          dir='auto'
          rows={3}
          value={value.message}
          maxLength={GIFT_MESSAGE_MAX}
          placeholder={placeholders.message}
          onChange={update('message', GIFT_MESSAGE_MAX)}
          className={clsx(
            'textarea settings-content -ms-2 min-h-20 w-[calc(100%+0.5rem)] resize-none rounded-md px-2! leading-snug',
            'border-0! bg-transparent! hover:bg-base-200/60! focus:bg-base-200/60!',
            'focus:border-0! focus:shadow-none! focus:outline-hidden! focus:ring-0!',
          )}
        />
      </div>
    </BoxedList>
  );
};

interface GiftComposerProps {
  prices: GiftPrice[];
  defaultSenderName: string;
  busy: boolean;
  onBuy: (draft: GiftDraftInput, price: GiftPrice) => void;
}

// What a year of the tier gives, from its plan card: the storage line leads
// with its size ("5 GB Cloud Sync Storage"), and Free's benefits go unsaid on a
// paid gift.
const tierFeatures = (tier: GiftTier, _: TranslationFunc): string[] => {
  const { features, limits = {} } = getPlanDetails(tier, []);
  return features
    .filter(({ label }) => label !== 'Includes All Free Plan Benefits')
    .map(({ label }) => (limits[label] ? `${limits[label]} ${_(label)}` : _(label)));
};

// Owner chose "buy, then write": the buyer picks a plan and pays; the card is
// written afterwards, in Sent. Everything on it can still change until it's
// redeemed.
const GiftComposer: React.FC<GiftComposerProps> = ({ prices, defaultSenderName, busy, onBuy }) => {
  const _ = useTranslation();
  const [tier, setTier] = useState<GiftTier>('plus');
  const senderName = defaultSenderName.slice(0, GIFT_NAME_MAX);
  // A plan pick shows the cover, where the plan is printed.
  const [side, setSide] = useState<GiftCardSide>('front');
  const price = prices.find((p) => p.tier === tier);
  const accent = getPlanAccent(tier);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!price || busy) return;
    onBuy({ tier, recipientName: '', senderName, message: '', recipientEmail: null }, price);
  };

  return (
    <form onSubmit={handleSubmit} className='@container flex flex-col gap-4'>
      <GiftCard
        face={{ tier, recipientName: '', senderName, message: '' }}
        placeholders={facePlaceholders(_)}
        side={side}
        onSideChange={setSide}
        className='mx-auto max-w-sm'
      />

      {/* Side by side only where each option fits on two lines. */}
      <div
        role='radiogroup'
        aria-label={_('Plan')}
        className='@min-[21.25rem]:grid-cols-2 grid grid-cols-1 gap-3'
      >
        {TIERS.map((option) => {
          const optionPrice = prices.find((p) => p.tier === option);
          const selected = option === tier;
          return (
            <label
              key={option}
              className={clsx(
                'eink-bordered bg-base-100 flex items-center gap-3 rounded-lg border px-3 py-3',
                'transition-colors duration-150',
                selected
                  ? ['border-base-content/30', getPlanAccent(option).border]
                  : 'border-base-200 hover:border-base-300',
                optionPrice ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type='radio'
                name='gift-tier'
                value={option}
                checked={selected}
                disabled={!optionPrice}
                onChange={() => {
                  setTier(option);
                  setSide('front');
                }}
                className='radio radio-sm eink:border-base-content shrink-0'
              />
              <span className='flex min-w-0 flex-col'>
                <SettingLabel>
                  {_('Readest {{plan}}', { plan: giftTierName(option, _) })}
                </SettingLabel>
                <span className='text-base-content/70 text-[0.85em]'>
                  {optionPrice ? `${_('1 year')} · ${formatPrice(optionPrice)}` : _('1 year')}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <ul className='bg-base-200/60 eink-bordered flex flex-col gap-2 rounded-lg p-4'>
        {tierFeatures(tier, _).map((feature) => (
          <li key={feature} className='flex items-start gap-2 text-sm'>
            <IoCheckmark className={clsx('mt-0.5 h-4 w-4 shrink-0', accent.check)} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {/* The one call to action here (DESIGN.md 4.2). */}
      <button type='submit' disabled={busy || !price} className='btn btn-primary w-full'>
        {busy && <span className='loading loading-spinner loading-sm' />}
        {price ? _('Buy for {{price}}', { price: formatPrice(price) }) : _('Buy')}
      </button>

      <ul className='text-base-content/70 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs'>
        {[
          _('One payment, no subscription'),
          _('Write the card after you pay'),
          _('Their year starts when they redeem it'),
        ].map((point) => (
          <li key={point} className='flex items-center gap-1'>
            <IoCheckmark className='h-3.5 w-3.5 shrink-0' />
            {point}
          </li>
        ))}
      </ul>
    </form>
  );
};

export default GiftComposer;
