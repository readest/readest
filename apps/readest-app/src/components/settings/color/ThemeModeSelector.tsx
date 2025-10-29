import React from 'react';
import { MdOutlineLightMode, MdOutlineDarkMode } from 'react-icons/md';
import { TbSunMoon } from 'react-icons/tb';
import { useTranslation } from '@/hooks/useTranslation';

interface ThemeModeSelectorProps {
  themeMode: 'auto' | 'light' | 'dark';
  onThemeModeChange: (mode: 'auto' | 'light' | 'dark') => void;
}

const ThemeModeSelector: React.FC<ThemeModeSelectorProps> = ({ themeMode, onThemeModeChange }) => {
  const _ = useTranslation();

  return (
    <div className='flex items-center justify-between'>
      <h2 className='font-medium'>{_('Theme Mode')}</h2>
      <div className='flex gap-4'>
        <button
          title={_('Auto Mode')}
          className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'auto' ? 'btn-active bg-base-300' : ''}`}
          onClick={() => onThemeModeChange('auto')}
        >
          <TbSunMoon />
        </button>
        <button
          title={_('Light Mode')}
          className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'light' ? 'btn-active bg-base-300' : ''}`}
          onClick={() => onThemeModeChange('light')}
        >
          <MdOutlineLightMode />
        </button>
        <button
          title={_('Dark Mode')}
          className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'dark' ? 'btn-active bg-base-300' : ''}`}
          onClick={() => onThemeModeChange('dark')}
        >
          <MdOutlineDarkMode />
        </button>
      </div>
    </div>
  );
};

export default ThemeModeSelector;
