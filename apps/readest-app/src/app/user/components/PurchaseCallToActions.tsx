import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { GiftPrice } from '@/types/gift';
import { PlanType } from '@/types/quota';
import { getLocale } from '@/utils/misc';
import { PlanAccent, PlanDetails } from '../utils/plan';

interface PurchaseCallToActionsProps {
  plan: PlanDetails;
  accent: PlanAccent;
  /** Defaults to false: an unknown state shows the buy button, never hides it. */
  customizationPurchased?: boolean;
  /** Empty until they load; the Gift Card tile then shows the lowest. */
  giftPrices?: GiftPrice[];
  onSubscribe: (priceId?: string, planType?: PlanType) => void;
  onGiftCard?: () => void;
}

// Every tile sets a name over a price, and a tile with no price keeps the same
// height (min-h-13: p-2 plus a text-sm and a text-xs line).
const tileClass = clsx(
  'flex min-h-13 w-full flex-col items-center justify-center rounded-lg p-2 text-center',
  'eink-bordered',
);

// Add-on tiles extend the Lifetime card, so they share its surface vocabulary
// and lift one step on hover rather than recolouring (DESIGN.md 2.1 / 2.3).
const productButtonClass = clsx(
  tileClass,
  'bg-base-200 hover:bg-base-300 transition-colors duration-150',
  'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
);

const tileTextClass = 'text-sm font-semibold';
// E-ink keeps text at full ink: its rules flatten colours, not opacity.
const tilePriceClass = 'text-xs font-bold not-eink:opacity-80';

const formatPrice = (price: number, currency: string) =>
  new Intl.NumberFormat(getLocale(), { style: 'currency', currency }).format(price / 100);

const PurchaseCallToActions: React.FC<PurchaseCallToActionsProps> = ({
  plan,
  accent,
  customizationPurchased = false,
  giftPrices = [],
  onSubscribe,
  onGiftCard,
}) => {
  const _ = useTranslation();

  const lowestGiftPrice = giftPrices.reduce<GiftPrice | undefined>(
    (lowest, price) => (!lowest || price.price < lowest.price ? price : lowest),
    undefined,
  );
  const giftCardButton = onGiftCard && (
    <div className='grid grid-cols-1 gap-2'>
      <button onClick={onGiftCard} className={clsx(productButtonClass, accent.tile)}>
        <span className={tileTextClass}>{_('Gift Card')}</span>
        {lowestGiftPrice && (
          <span className={tilePriceClass}>
            {_('From {{price}}', {
              price: formatPrice(lowestGiftPrice.price, lowestGiftPrice.currency),
            })}
          </span>
        )}
      </button>
    </div>
  );

  // Gift cards are not among these products, and the Gift Card view lists the
  // cards you bought, so the button stays when the products are missing.
  if (!plan.products || plan.products.length === 0) {
    return giftCardButton || null;
  }

  const storageProducts = plan.products.filter((product) => product.feature === 'storage');
  const customizationProducts = plan.products.filter(
    (product) => product.feature === 'customization',
  );

  // Owned or not yet sold: set like the tiles beside it but quieter, an
  // outline with muted text and no fill, so it never looks more tappable than
  // the tiles that are (owner: "the unlocked full customization has darker
  // color for other clickable products, this is counterintuitive").
  const statusTile = (label: string, price?: string) => (
    <div className='grid grid-cols-1 gap-2'>
      <div
        aria-disabled='true'
        className={clsx(tileClass, 'border-base-content/15 text-base-content/60 border')}
      >
        <span className={tileTextClass}>{label}</span>
        {price && <span className={tilePriceClass}>{price}</span>}
      </div>
    </div>
  );

  // An unlocked Full Customization goes last, below what can still be bought,
  // and keeps its price as the anchor for the tiles above it.
  const customization = customizationProducts[0];
  const customizationPrice =
    customization && formatPrice(customization.price, customization.currency);

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
              <span className={tilePriceClass}>{formatPrice(product.price, product.currency)}</span>
            </button>
          ))}
        </div>
      )}

      {customizationPurchased ? null : customizationProducts.length > 0 ? (
        <div className='grid grid-cols-1 gap-2'>
          {customizationProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => onSubscribe(product.id, 'purchase')}
              className={clsx(productButtonClass, accent.tile)}
            >
              <span className={tileTextClass}>{_(product.name)}</span>
              <span className={tilePriceClass}>{formatPrice(product.price, product.currency)}</span>
            </button>
          ))}
        </div>
      ) : (
        statusTile(`${_('Full Customization')} (${_('Coming Soon')})`)
      )}

      {giftCardButton}

      {customizationPurchased &&
        statusTile(`${_('Full Customization')} (${_('Unlocked')})`, customizationPrice)}
    </div>
  );
};

export default PurchaseCallToActions;
