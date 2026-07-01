import clsx from 'clsx';
import React from 'react';
import { MdCheck } from 'react-icons/md';
import { BookSearchConfig, SearchMode } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { DEFAULT_NEARBY_WORDS, modeToWholeWords } from '@/utils/searchConfig';

interface SearchOptionsProps {
  isEink: boolean;
  searchConfig: BookSearchConfig;
  menuClassName?: string;
  onSearchConfigChanged: (searchConfig: BookSearchConfig) => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

interface OptionProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  caption?: string;
}

const Option: React.FC<OptionProps> = ({ label, isActive, onClick, disabled, caption }) => (
  <button
    disabled={disabled}
    className={clsx(
      'hover:bg-base-300 flex w-full items-center justify-between rounded-md p-2',
      disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
    )}
    onClick={disabled ? undefined : onClick}
  >
    <div className='flex items-center'>
      <span style={{ minWidth: `${useDefaultIconSize()}px` }}>
        {isActive && <MdCheck className='text-base-content' />}
      </span>
      <span className='ml-2'>{label}</span>
    </div>
    {caption && <span className='text-base-content/50 ml-2 text-xs'>{caption}</span>}
  </button>
);

const NEARBY_WORDS_PRESETS = [5, 10, 20, 50];

const SearchOptions: React.FC<SearchOptionsProps> = ({
  isEink,
  searchConfig,
  menuClassName,
  onSearchConfigChanged,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const iconSize = useDefaultIconSize();
  // Align nested nearby controls with the option label column, not the checkmark
  // icon. An option label sits at button p-2 (8px) + icon width + ml-2 gap (8px);
  // this inline padding-inline-start replaces the row's own px-2 left padding.
  const labelIndent = `${iconSize + 16}px`;
  const updateConfig = (key: keyof BookSearchConfig, value: boolean | string | number) => {
    onSearchConfigChanged({ ...searchConfig, [key]: value });
    setIsDropdownOpen?.(false);
  };
  const setMode = (mode: SearchMode) => {
    onSearchConfigChanged({ ...searchConfig, mode, matchWholeWords: modeToWholeWords(mode) });
    setIsDropdownOpen?.(false);
  };

  const mode = searchConfig.mode;
  // regex matches raw text, so the diacritics modifier has no effect there.
  const diacriticsDisabled = mode === 'regex';

  return (
    <div
      className={clsx(
        'search-options dropdown-content border-base-200 z-20 w-56 border shadow-2xl',
        isEink ? 'bordercolor-content border-base-content !bg-base-100 border' : '',
        menuClassName,
      )}
    >
      <Option
        label={_('Book')}
        isActive={searchConfig.scope === 'book'}
        onClick={() => updateConfig('scope', 'book')}
      />
      <Option
        label={_('Chapter')}
        isActive={searchConfig.scope === 'section'}
        onClick={() => updateConfig('scope', 'section')}
      />
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <Option
        label={_('Contains')}
        isActive={mode === 'contains'}
        onClick={() => setMode('contains')}
      />
      <Option
        label={_('Whole Words')}
        isActive={mode === 'whole-words'}
        onClick={() => setMode('whole-words')}
      />
      <Option
        label={_('Regular Expression')}
        isActive={mode === 'regex'}
        onClick={() => setMode('regex')}
      />
      <Option
        label={_('Nearby Words')}
        isActive={mode === 'nearby-words'}
        onClick={() => setMode('nearby-words')}
      />
      {mode === 'nearby-words' && (
        <div className='px-2 py-1' style={{ paddingInlineStart: labelIndent }}>
          <div className='text-base-content/70 mb-1 text-xs'>{_('Within N words')}</div>
          <div className='flex gap-1'>
            {NEARBY_WORDS_PRESETS.map((n) => (
              <button
                key={n}
                className={clsx(
                  'rounded-md px-2 py-1 text-xs',
                  (searchConfig.nearbyWords ?? DEFAULT_NEARBY_WORDS) === n
                    ? 'bg-base-300 font-bold'
                    : 'hover:bg-base-300',
                )}
                onClick={() => updateConfig('nearbyWords', n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <Option
        label={_('Match Case')}
        isActive={searchConfig.matchCase}
        onClick={() => updateConfig('matchCase', !searchConfig.matchCase)}
      />
      <Option
        label={_('Match Diacritics')}
        isActive={searchConfig.matchDiacritics && !diacriticsDisabled}
        disabled={diacriticsDisabled}
        caption={diacriticsDisabled ? _('Not for regex') : undefined}
        onClick={() => updateConfig('matchDiacritics', !searchConfig.matchDiacritics)}
      />
    </div>
  );
};

export default SearchOptions;
