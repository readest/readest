import clsx from 'clsx';
import { MdCheck } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import type { LibrarySearchConfig } from '@/types/book';
import { DEFAULT_NEARBY_WORDS } from '@/utils/searchConfig';

export type LibrarySearchTarget = 'books' | 'contents';

interface LibrarySearchMenuProps {
  target: LibrarySearchTarget;
  config: LibrarySearchConfig;
  menuClassName?: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onTargetChange: (target: LibrarySearchTarget) => void;
  onConfigChange: (config: LibrarySearchConfig) => void;
}

const NEARBY_PRESETS = [5, 10, 20, 50];

const LibrarySearchMenu = ({
  target,
  config,
  menuClassName,
  setIsDropdownOpen,
  onTargetChange,
  onConfigChange,
}: LibrarySearchMenuProps) => {
  const _ = useTranslation();
  const close = () => setIsDropdownOpen?.(false);
  const chooseTarget = (value: LibrarySearchTarget) => {
    onTargetChange(value);
    close();
  };
  const chooseMode = (mode: LibrarySearchConfig['mode']) => {
    onConfigChange({ ...config, mode, matchWholeWords: mode === 'whole-words' });
    if (mode !== 'nearby-words') close();
  };
  const update = (
    key: 'matchCase' | 'matchDiacritics' | 'nearbyWords',
    value: boolean | number,
  ) => {
    onConfigChange({ ...config, [key]: value });
    close();
  };
  const option = (
    label: string,
    active: boolean,
    onClick: () => void,
    disabled = false,
    role: 'menuitemradio' | 'menuitemcheckbox' = 'menuitemradio',
  ) => (
    <button
      type='button'
      role={role}
      aria-checked={active}
      disabled={disabled}
      className={clsx(
        'hover:bg-base-300 flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm',
        disabled && 'cursor-not-allowed opacity-40',
      )}
      onClick={onClick}
    >
      <span className='w-4'>{active && <MdCheck />}</span>
      {label}
    </button>
  );

  return (
    <div
      role='menu'
      className={clsx(
        'menu-container dropdown-content border-base-200 bg-base-100 eink-bordered z-50 w-60 rounded-lg border p-1 shadow-2xl',
        menuClassName,
      )}
    >
      {option(_('Books'), target === 'books', () => chooseTarget('books'))}
      {option(_('Contents'), target === 'contents', () => chooseTarget('contents'))}
      {target === 'contents' && (
        <>
          <hr aria-hidden='true' className='border-base-200 my-1' />
          {option(_('Contains'), config.mode === 'contains', () => chooseMode('contains'))}
          {option(_('Whole Words'), config.mode === 'whole-words', () => chooseMode('whole-words'))}
          {option(_('Regular Expression'), config.mode === 'regex', () => chooseMode('regex'))}
          {option(_('Nearby Words'), config.mode === 'nearby-words', () =>
            chooseMode('nearby-words'),
          )}
          {option(_('Fuzzy'), config.mode === 'fuzzy', () => chooseMode('fuzzy'))}
          {config.mode === 'nearby-words' && (
            <div className='px-3 py-2'>
              <div className='text-base-content/60 mb-1 text-xs'>{_('Within N words')}</div>
              <div role='group' aria-label={_('Within N words')} className='flex gap-1'>
                {NEARBY_PRESETS.map((value) => (
                  <button
                    key={value}
                    type='button'
                    aria-pressed={(config.nearbyWords ?? DEFAULT_NEARBY_WORDS) === value}
                    className={clsx(
                      'rounded px-2 py-1 text-xs',
                      (config.nearbyWords ?? DEFAULT_NEARBY_WORDS) === value
                        ? 'bg-base-300 font-bold'
                        : 'hover:bg-base-300',
                    )}
                    onClick={() => update('nearbyWords', value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
          <hr aria-hidden='true' className='border-base-200 my-1' />
          {option(
            _('Match Case'),
            config.matchCase,
            () => update('matchCase', !config.matchCase),
            false,
            'menuitemcheckbox',
          )}
          {option(
            _('Match Diacritics'),
            config.matchDiacritics && config.mode !== 'regex',
            () => update('matchDiacritics', !config.matchDiacritics),
            config.mode === 'regex',
            'menuitemcheckbox',
          )}
        </>
      )}
    </div>
  );
};

export default LibrarySearchMenu;
