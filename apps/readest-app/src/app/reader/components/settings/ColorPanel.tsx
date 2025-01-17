import React, { useEffect } from 'react';
import { MdOutlineLightMode, MdOutlineDarkMode } from 'react-icons/md';
import { MdRadioButtonUnchecked, MdRadioButtonChecked } from 'react-icons/md';
import { TbSunMoon } from 'react-icons/tb';

import { useTheme } from '@/hooks/useTheme';
import { themes } from '@/styles/themes';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { getStyles } from '@/utils/style';

const ColorPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { themeMode, themeColor, themeCode, isDarkMode, updateThemeMode, updateThemeColor } =
    useTheme();
  const { getViews, getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;

  useEffect(() => {
    getViews().forEach((view) => {
      view.renderer.setStyles?.(getStyles(viewSettings!, themeCode));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeCode]);

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='font-medium'>{_('Theme Mode')}</h2>
        <div className='flex gap-2'>
          <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Auto Mode')}>
            <button
              className={`btn btn-ghost btn-circle ${themeMode === 'auto' ? 'btn-active bg-base-300' : ''}`}
              onClick={() => updateThemeMode('auto')}
            >
              <TbSunMoon size={20} />
            </button>
          </div>

          <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Light Mode')}>
            <button
              className={`btn btn-ghost btn-circle ${themeMode === 'light' ? 'btn-active bg-base-300' : ''}`}
              onClick={() => updateThemeMode('light')}
            >
              <MdOutlineLightMode size={20} />
            </button>
          </div>

          <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Dark Mode')}>
            <button
              className={`btn btn-ghost btn-circle ${themeMode === 'dark' ? 'btn-active bg-base-300' : ''}`}
              onClick={() => updateThemeMode('dark')}
            >
              <MdOutlineDarkMode size={20} />
            </button>
          </div>
        </div>
      </div>

      <div>
        <h2 className='mb-2 font-medium'>{_('Theme Color')}</h2>
        <div className='grid grid-cols-3 gap-4'>
          {themes.map(({ name, label, colors }) => (
            <label
              key={name}
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg p-4 shadow-md ${
                themeColor === name ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
              }`}
              style={{
                backgroundColor: isDarkMode ? colors.dark['base-100'] : colors.light['base-100'],
                color: isDarkMode ? colors.dark['base-content'] : colors.light['base-content'],
              }}
            >
              <input
                type='radio'
                name='theme'
                value={name}
                checked={themeColor === name}
                onChange={() => updateThemeColor(name)}
                className='hidden'
              />
              {themeColor === name ? (
                <MdRadioButtonChecked size={24} />
              ) : (
                <MdRadioButtonUnchecked size={24} />
              )}
              <span>{_(label)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ColorPanel;
