import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { PlanType } from '@/types/quota';
import { getLocale } from '@/utils/misc';
import { PlanDetails } from '../utils/plan';

interface PurchaseCallToActionsProps {
  plan: PlanDetails;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

// Add-on tiles extend the Lifetime card, so they share its surface vocabulary
// and lift one step on hover rather than recolouring (DESIGN.md 2.1 / 2.3).
const productButtonClass = clsx(
  'flex w-full flex-col items-center justify-center rounded-lg p-2',
  'bg-base-200 hover:bg-base-300 eink-bordered transition-colors duration-150',
  'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
);

const PurchaseCallToActions: React.FC<PurchaseCallToActionsProps> = ({ plan, onSubscribe }) => {
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
              className={productButtonClass}
            >
              <span className='text-base-content text-sm font-semibold'>{_(product.name)}</span>
              <span className='text-base-content/70 text-xs font-bold'>
                {formatProductPrice(product.price, product.currency)}
              </span>
            </button>
          ))}
        </div>
      )}

      {customizationProducts.length > 0 ? (
        <div className='grid grid-cols-1 gap-2'>
          {customizationProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => onSubscribe(product.id, 'purchase')}
              className={productButtonClass}
            >
              <span className='text-base-content text-sm font-semibold'>{_(product.name)}</span>
              <span className='text-base-content/70 text-xs font-bold'>
                {formatProductPrice(product.price, product.currency)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-2'>
          <div className='bg-base-200/60 eink-bordered flex min-h-14 w-full flex-col items-center justify-center rounded-lg p-2'>
            <span className='text-base-content/60 text-sm font-medium'>
              {_('Full Customization')} ({_('Coming Soon')})
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchaseCallToActions;
