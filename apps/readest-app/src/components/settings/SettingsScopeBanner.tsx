import clsx from 'clsx';
import React from 'react';
import { MdOutlineMenuBook, MdOutlinePublic } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { isSettingsScopeGlobal } from '@/helpers/settings';

/**
 * The banner chassis, and one tint for each scope.
 *
 * `scope-banner-eink.browser.test.tsx` imports these and measures the colours
 * that the browser computes. Keep `eink-bordered` and the tint on one element.
 * That class removes the tint and the thick edge together on e-ink. On another
 * element it would remove neither. `scopeWiring.test.ts` and the banner unit
 * test guard that rule. The browser test cannot guard it, because it renders its
 * own elements.
 */
export const SCOPE_BANNER_CHASSIS =
  'eink-bordered mb-1 flex w-full items-center gap-2 rounded-lg border-s-4 px-2.5 py-1';
export const SCOPE_BANNER_GLOBAL_TINT = 'border-info bg-info/15';
export const SCOPE_BANNER_BOOK_TINT = 'border-warning bg-warning/10';

interface SettingsScopeBannerProps {
  bookKey: string;
  /** True if the flag does not control this panel. The banner then says "Always". */
  alwaysGlobal: boolean;
}

/**
 * This banner shows which store the open panel writes to.
 *
 * The dialog puts the banner in the header. The body scrolls, but the header
 * stays on the screen.
 *
 * The banner is read-only. The ⋮ menu changes the scope.
 */
const SettingsScopeBanner: React.FC<SettingsScopeBannerProps> = ({ bookKey, alwaysGlobal }) => {
  const _ = useTranslation();
  // This reads the whole reader store, as `DialogMenu` does. `applyViewSettings`
  // changes the view-settings object in place. A selector that returns that
  // object thus does not start a new render. A selector that calls the resolver
  // on `viewStates[bookKey]?.viewSettings` also works, and it subscribes more
  // narrowly. The banner is one row, so the cost of the wider subscription is
  // small, and `DialogMenu` reads the store this way. `scopeWiring.test.ts` pins
  // the call below with this argument, so change that test with the code.
  const { getViewSettings } = useReaderStore();
  const isGlobal = alwaysGlobal || isSettingsScopeGlobal(getViewSettings(bookKey));

  const ScopeIcon = isGlobal ? MdOutlinePublic : MdOutlineMenuBook;

  return (
    <div
      // The ⋮ menu announces nothing when it closes. This region announces the
      // new scope.
      role='status'
      aria-live='polite'
      className={clsx(
        SCOPE_BANNER_CHASSIS,
        // Blue shows global. Amber shows one book. Global is the usual state,
        // thus it must not look like a warning. Colour is never the only
        // signal. Refer to scope-banner-eink.browser.test.
        isGlobal ? SCOPE_BANNER_GLOBAL_TINT : SCOPE_BANNER_BOOK_TINT,
      )}
    >
      <ScopeIcon className='text-base-content h-4 w-4 shrink-0' aria-hidden='true' />
      <span className='text-base-content min-w-0 flex-1 truncate text-[0.8em]'>
        {/* "Global Settings" is the text of the Settings Menu item. The two
            thus agree. The row omits the book title on purpose. The row
            truncates, and a title pushes the last words off the end. */}
        {alwaysGlobal
          ? _('Always Global Settings')
          : isGlobal
            ? _('Global Settings')
            : _('This Book — Overrides Global Settings')}
      </span>
    </div>
  );
};

export default SettingsScopeBanner;
