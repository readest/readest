import clsx from 'clsx';
import { MdCheck } from 'react-icons/md';

import { useTranslation } from '@/hooks/useTranslation';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import type { LibrarySearchConfig } from '@/types/book';
import { DEFAULT_NEARBY_WORDS } from '@/utils/searchConfig';

interface OptionProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const Option: React.FC<OptionProps> = ({ label, isActive, onClick, disabled }) => {
  const iconSize = useDefaultIconSize();
  return (
    <button
      disabled={disabled}
      className={clsx(
        'hover:bg-base-300 flex w-full items-center justify-between rounded-md p-2',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
      )}
      onClick={disabled ? undefined : onClick}
    >
      <div className='flex items-center'>
        <span style={{ minWidth: `${iconSize}px` }}>
          {isActive && <MdCheck className='text-base-content' />}
        </span>
        <span className='ml-2 whitespace-nowrap'>{label}</span>
      </div>
    </button>
  );
};

const NEARBY_WORDS_PRESETS = [5, 10, 20, 50];

interface LibrarySearchOptionsMenuProps {
  config: LibrarySearchConfig;
  menuClassName?: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onConfigChange: (config: LibrarySearchConfig) => void;
}

const LibrarySearchOptionsMenu: React.FC<LibrarySearchOptionsMenuProps> = ({
  config,
  menuClassName,
  setIsDropdownOpen,
  onConfigChange,
}) => {
  const _ = useTranslation();
  const iconSize = useDefaultIconSize();
  // Align nested nearby controls with the option label column, matching the
  // reader sidebar's SearchOptions menu.
  const labelIndent = `${iconSize + 16}px`;
  const update = (
    key: 'matchCase' | 'matchDiacritics' | 'nearbyWords',
    value: boolean | number,
  ) => {
    onConfigChange({ ...config, [key]: value });
    setIsDropdownOpen?.(false);
  };
  const setMode = (mode: LibrarySearchConfig['mode']) => {
    onConfigChange({ ...config, mode, matchWholeWords: mode === 'whole-words' });
    if (mode !== 'nearby-words') setIsDropdownOpen?.(false);
  };

  const diacriticsDisabled = config.mode === 'regex';

  return (
    <div
      role='menu'
      className={clsx(
        'search-options dropdown-content border-base-200 bg-base-100 eink-bordered z-20 rounded-lg border p-1 shadow-2xl',
        // No fixed width: a device text scale (Android system font size) scales
        // every font-size but not a `w-56` box, so labels wrapped and the menu
        // outgrew the landscape viewport. `.dropdown-content` already sizes the
        // box to its content and caps it at the viewport. Same scroll contract
        // as the shared Menu component behind the view and settings menus.
        'max-h-[calc(100vh-96px)] overflow-y-auto',
        menuClassName,
      )}
    >
      <Option
        label={_('Contains')}
        isActive={config.mode === 'contains'}
        onClick={() => setMode('contains')}
      />
      <Option
        label={_('Whole Words')}
        isActive={config.mode === 'whole-words'}
        onClick={() => setMode('whole-words')}
      />
      <Option
        label={_('Regular Expression')}
        isActive={config.mode === 'regex'}
        onClick={() => setMode('regex')}
      />
      <Option
        label={_('Nearby Words')}
        isActive={config.mode === 'nearby-words'}
        onClick={() => setMode('nearby-words')}
      />
      {config.mode === 'nearby-words' && (
        <div className='px-2 py-1' style={{ paddingInlineStart: labelIndent }}>
          <div className='text-base-content/70 mb-1 text-xs'>{_('Within N words')}</div>
          <div className='flex gap-1'>
            {NEARBY_WORDS_PRESETS.map((value) => (
              <button
                key={value}
                aria-pressed={(config.nearbyWords ?? DEFAULT_NEARBY_WORDS) === value}
                className={clsx(
                  'rounded-md px-2 py-1 text-xs',
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
      <Option
        label={_('Fuzzy')}
        isActive={config.mode === 'fuzzy'}
        onClick={() => setMode('fuzzy')}
      />
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <Option
        label={_('Match Case')}
        isActive={config.matchCase}
        onClick={() => update('matchCase', !config.matchCase)}
      />
      <Option
        label={_('Match Diacritics')}
        isActive={config.matchDiacritics && !diacriticsDisabled}
        disabled={diacriticsDisabled}
        onClick={() => update('matchDiacritics', !config.matchDiacritics)}
      />
    </div>
  );
};

export default LibrarySearchOptionsMenu;
