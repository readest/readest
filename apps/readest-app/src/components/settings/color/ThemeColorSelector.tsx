import React from 'react';
import { CgColorPicker } from 'react-icons/cg';
import { MdRadioButtonUnchecked, MdRadioButtonChecked } from 'react-icons/md';
import { PiPlus } from 'react-icons/pi';
import { Theme } from '@/styles/themes';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface ThemeColorSelectorProps {
  themes: Theme[];
  themeColor: string;
  isDarkMode: boolean;
  onThemeColorChange: (name: string) => void;
  onEditTheme: (name: string) => void;
  onCreateTheme: () => void;
}

const ThemeColorSelector: React.FC<ThemeColorSelectorProps> = ({
  themes,
  themeColor,
  isDarkMode,
  onThemeColorChange,
  onEditTheme,
  onCreateTheme,
}) => {
  const _ = useTranslation();
  const iconSize16 = useResponsiveSize(16);
  const iconSize24 = useResponsiveSize(24);

  return (
    <div>
      <h2 className='mb-2 font-medium'>{_('Theme Color')}</h2>
      <div className='grid grid-cols-3 gap-4'>
        {themes.map(({ name, label, colors, isCustomizale }) => (
          <button
            key={name}
            tabIndex={0}
            onClick={() => onThemeColorChange(name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onThemeColorChange(name);
              }
              e.stopPropagation();
            }}
            className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg px-2 py-4 shadow-md ${
              themeColor === name ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
            }`}
            style={{
              backgroundColor: isDarkMode ? colors.dark['base-100'] : colors.light['base-100'],
              color: isDarkMode ? colors.dark['base-content'] : colors.light['base-content'],
            }}
          >
            <input
              aria-label={_(label)}
              type='radio'
              name='theme'
              value={name}
              checked={themeColor === name}
              onChange={() => onThemeColorChange(name)}
              className='hidden'
            />
            {themeColor === name ? (
              <MdRadioButtonChecked size={iconSize24} />
            ) : (
              <MdRadioButtonUnchecked size={iconSize24} />
            )}
            <span className='max-w-full truncate'>{_(label)}</span>
            {isCustomizale && themeColor === name && (
              <button onClick={() => onEditTheme(name)}>
                <CgColorPicker size={iconSize16} className='absolute right-2 top-2' />
              </button>
            )}
          </button>
        ))}
        <button
          className='relative flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-2 py-4 shadow-md'
          onClick={onCreateTheme}
        >
          <PiPlus size={iconSize24} />
          <span className='max-w-full truncate'>{_('Custom')}</span>
        </button>
      </div>
    </div>
  );
};

export default ThemeColorSelector;
