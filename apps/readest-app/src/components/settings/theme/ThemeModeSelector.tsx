import clsx from 'clsx';
import React from 'react';
import { MdOutlineLightMode, MdOutlineDarkMode } from 'react-icons/md';
import { TbSunMoon } from 'react-icons/tb';
import { useTranslation } from '@/hooks/useTranslation';
import { useAtmosphereStore } from '@/store/atmosphereStore';
import { SettingLabel } from '../primitives';

interface ThemeModeSelectorProps {
  themeMode: 'auto' | 'light' | 'dark';
  onThemeModeChange: (mode: 'auto' | 'light' | 'dark') => void;
}

const ThemeModeSelector: React.FC<ThemeModeSelectorProps> = ({ themeMode, onThemeModeChange }) => {
  const _ = useTranslation();
  const { spinDirection, shaking, toggle, toggleWithShake, deactivate } = useAtmosphereStore();

  const handleAutoClick = () => {
    deactivate();
    onThemeModeChange('auto');
  };

  const handleLightClick = () => {
    if (themeMode === 'light') {
      toggle();
    } else {
      deactivate();
      onThemeModeChange('light');
    }
  };

  const handleDarkClick = () => {
    if (themeMode === 'dark') {
      toggleWithShake();
    } else {
      deactivate();
      onThemeModeChange('dark');
    }
  };

  const segments = [
    { mode: 'auto' as const, title: _('Auto Mode'), onClick: handleAutoClick, icon: <TbSunMoon /> },
    {
      mode: 'light' as const,
      title: _('Light Mode'),
      onClick: handleLightClick,
      icon: (
        <span
          className={
            spinDirection === 'cw'
              ? 'animate-spin-cw'
              : spinDirection === 'ccw'
                ? 'animate-spin-ccw'
                : ''
          }
        >
          <MdOutlineLightMode />
        </span>
      ),
    },
    {
      mode: 'dark' as const,
      title: _('Dark Mode'),
      onClick: handleDarkClick,
      icon: (
        <span className={shaking ? 'animate-shake' : ''}>
          <MdOutlineDarkMode />
        </span>
      ),
    },
  ];

  return (
    <div className='flex items-center justify-between px-4'>
      <SettingLabel>{_('Theme Mode')}</SettingLabel>
      {/* Segmented control: three adjacent, equally sized radio segments share
          a single track. No `gap` between them, so there is no dead space to
          mis-tap, and each segment is a full-height rectangle instead of a
          32px icon — far easier to hit on touch screens (issue #4831). */}
      <div
        role='radiogroup'
        aria-label={_('Theme Mode')}
        className='bg-base-200 eink-bordered inline-flex items-center rounded-full p-0.5'
      >
        {segments.map(({ mode, title, onClick, icon }) => {
          const active = themeMode === mode;
          return (
            <button
              key={mode}
              type='button'
              role='radio'
              aria-checked={active}
              aria-label={title}
              title={title}
              onClick={onClick}
              className={clsx(
                'flex h-9 min-w-[2.75rem] items-center justify-center rounded-full px-3 text-lg transition-colors',
                'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
                // e-ink: mark the active segment with a solid `eink-inverted`
                // fill (base-content bg, base-100 icon) instead of a border —
                // a bordered thumb would nest awkwardly inside the track's own
                // border. The track keeps its `eink-bordered` outline.
                active
                  ? 'bg-base-300 text-base-content eink-inverted shadow-sm'
                  : 'text-base-content/60 hover:text-base-content',
              )}
            >
              {icon}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ThemeModeSelector;
