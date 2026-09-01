import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { PlanType } from '@/types/quota';
import { getLocale } from '@/utils/misc';
import { PlanAccent, PlanDetails } from '../utils/plan';

interface PurchaseCallToActionsProps {
  plan: PlanDetails;
  accent: PlanAccent;
  /** Defaults to false: an unknown state shows the buy button, never hides it. */
  customizationPurchased?: boolean;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

// Add-on tiles extend the Lifetime card, so they share its surface vocabulary
// and lift one step on hover rather than recolouring (DESIGN.md 2.1 / 2.3).
const productButtonClass = clsx(
  'flex w-full flex-col items-center justify-center rounded-lg p-2',
  'bg-base-200 hover:bg-base-300 eink-bordered transition-colors duration-150',
  'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
);

const tileTextClass = 'text-sm font-semibold';

const PurchaseCallToActions: React.FC<PurchaseCallToActionsProps> = ({
  plan,
  accent,
  customizationPurchased = false,
  onSubscribe,
}) => {
  const _ = useTranslation();

  if (!plan.products || plan.products.length === 0) {
    return null;
  }

  const storageProducts = plan.products.filter((product) => product.feature === 'storage');
  const customizationProducts = plan.products.filter(
    (product) => product.feature === 'customization',
  );

  const formatProductPrice = (price: number, currency: string) =>
    new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(price / 100);

  return (
    <div className='flex flex-col gap-4'>
      {storageProducts.length > 0 && (
        <div className='grid grid-cols-2 gap-2'>
          {storageProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => onSubscribe(product.id, 'purchase')}
              className={clsx(productButtonClass, accent.tile)}
            >
              <span className={tileTextClass}>{_(product.name)}</span>
              <span className='text-xs font-bold opacity-80'>
                {formatProductPrice(product.price, product.currency)}
              </span>
            </button>
          ))}
        </div>
      )}

      {customizationPurchased ? (
        <div className='grid grid-cols-1 gap-2'>
          {/* Owned: keep the tier colour and the button geometry, same chassis
              as the Current Plan chip, so the card footers still line up. */}
          <div
            aria-disabled='true'
            className={clsx(
              'btn eink-bordered pointer-events-none h-12 min-h-12 w-full',
              accent.current,
            )}
          >
            <span className='text-xs leading-tight font-medium whitespace-normal'>
              {_('Full Customization')} ({_('Unlocked')})
            </span>
          </div>
        </div>
      ) : customizationProducts.length > 0 ? (
        <div className='grid grid-cols-1 gap-2'>
          {customizationProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => onSubscribe(product.id, 'purchase')}
              className={clsx(productButtonClass, accent.tile)}
            >
              <span className={tileTextClass}>{_(product.name)}</span>
              <span className='text-xs font-bold opacity-80'>
                {formatProductPrice(product.price, product.currency)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-2'>
          {/* Same chassis as the Current Plan button so the two cards' footers
              line up whatever daisyUI sizes a button at. */}
          {/* Same treatment as the Current Plan chip: a disabled <button> is
              washed out to near-invisible grey, so this keeps the tier colour
              and the button's geometry. */}
          <div
            aria-disabled='true'
            className={clsx(
              'btn eink-bordered pointer-events-none h-12 min-h-12 w-full',
              accent.current,
            )}
          >
            <span className='text-xs leading-tight font-medium whitespace-normal'>
              {_('Full Customization')} ({_('Coming Soon')})
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchaseCallToActions;
