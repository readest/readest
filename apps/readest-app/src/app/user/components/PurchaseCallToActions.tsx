import { useTranslation } from '@/hooks/useTranslation';
import { PlanType } from '@/types/quota';
import { getLocale } from '@/utils/misc';
import { PlanDetails } from '../utils/plan';

interface PurchaseCallToActionsProps {
  plan: PlanDetails;
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
}

const PurchaseCallToActions: React.FC<PurchaseCallToActionsProps> = ({ plan, onSubscribe }) => {
  const _ = useTranslation();

  if (!plan.products || plan.products.length === 0) {
    return null;
  }

  const storageProducts = plan.products.filter((product) => product.feature === 'storage');
  const customizationProducts = plan.products.filter(
    (product) => product.feature === 'customization',
  );

  const formatProductPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency: currency,
    }).format(price / 100);
  };

  return (
    <div className='flex flex-col gap-4'>
      {storageProducts.length > 0 && (
        <div className='grid grid-cols-2 gap-2'>
          {storageProducts.map((product) => {
            const productPrice = formatProductPrice(product.price, product.currency);
            return (
              <button
                key={product.id}
                onClick={() => onSubscribe(product.id, 'purchase')}
                className='flex w-full flex-col items-center justify-center rounded-lg bg-green-200 p-2 transition-colors hover:bg-green-300'
              >
                <span className='text-base font-semibold text-green-800'>{_(product.name)}</span>
                <span className='text-sm font-bold text-green-600'>{productPrice}</span>
              </button>
            );
          })}
        </div>
      )}

      {customizationProducts.length > 0 ? (
        <div className='grid grid-cols-1 gap-2'>
          {customizationProducts.map((product) => {
            const productPrice = formatProductPrice(product.price, product.currency);
            return (
              <button
                key={product.id}
                onClick={() => onSubscribe(product.id, 'purchase')}
                className='flex w-full flex-col items-center justify-center rounded-lg bg-green-200 p-2 transition-colors hover:bg-green-300'
              >
                <span className='text-base font-semibold text-green-700'>{_(product.name)}</span>
                <span className='text-sm font-bold text-green-600'>{productPrice}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-2'>
          <button className='flex min-h-[3.5rem] w-full flex-col items-center justify-center rounded-lg bg-green-200 p-2'>
            <span className='text-base font-semibold text-green-700'>
              {_('Full Customization')} ({_('Coming Soon')})
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

export default PurchaseCallToActions;
