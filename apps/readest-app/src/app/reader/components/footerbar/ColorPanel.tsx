import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo } from 'react';
import { PiSun, PiMoon } from 'react-icons/pi';
import { TbSunMoon } from 'react-icons/tb';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { themes } from '@/styles/themes';
import { debounce } from '@/utils/debounce';
import Slider from '@/components/Slider';

const SCREEN_BRIGHTNESS_LIMITS = {
  MIN: 0,
  MAX: 100,
  DEFAULT: 50,
} as const;

interface ColorPanelProps {
  actionTab: string;
  bottomOffset: string;
}

export const ColorPanel: React.FC<ColorPanelProps> = ({ actionTab, bottomOffset }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { getScreenBrightness, setScreenBrightness } = useDeviceControlStore();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor } = useThemeStore();

  const [screenBrightnessValue, setScreenBrightnessValue] = React.useState(
    settings.screenBrightness >= 0 ? settings.screenBrightness : SCREEN_BRIGHTNESS_LIMITS.DEFAULT,
  );

  useEffect(() => {
    if (!appService?.isMobileApp) return;
    if (settings.screenBrightness >= 0) return;

    getScreenBrightness().then((brightness) => {
      if (brightness >= 0.0 && brightness <= 1.0) {
        const screenBrightness = Math.round(brightness * 100);
        setScreenBrightnessValue(screenBrightness);
      }
    });
  }, [appService, settings, setSettings, getScreenBrightness]);

  const debouncedSetScreenBrightness = useMemo(
    () =>
      debounce(async (value: number) => {
        settings.screenBrightness = value;
        setSettings(settings);
        saveSettings(envConfig, settings);
        await setScreenBrightness(value / 100);
      }, 100),
    [envConfig, settings, setSettings, saveSettings, setScreenBrightness],
  );

  const handleScreenBrightnessChange = useCallback(
    async (value: number) => {
      if (!appService?.isMobileApp) return;

      setScreenBrightnessValue(value);
      debouncedSetScreenBrightness(value);
    },
    [appService, debouncedSetScreenBrightness],
  );

  const cycleThemeMode = () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  };

  const classes = clsx(
    'footerbar-color-mobile bg-base-200 absolute flex w-full flex-col items-center gap-y-8 px-4 transition-all sm:hidden',
    actionTab === 'color'
      ? 'pointer-events-auto translate-y-0 pb-4 pt-8 ease-out'
      : 'pointer-events-none invisible translate-y-full overflow-hidden pb-0 pt-0 ease-in',
  );

  return (
    <div className={classes} style={{ bottom: bottomOffset }}>
      {appService?.hasScreenBrightness && (
        <Slider
          label={_('Screen Brightness')}
          initialValue={screenBrightnessValue}
          bubbleLabel={`${screenBrightnessValue}`}
          minIcon={<PiSun size={16} />}
          maxIcon={<PiSun size={24} />}
          onChange={handleScreenBrightnessChange}
          min={SCREEN_BRIGHTNESS_LIMITS.MIN}
          max={SCREEN_BRIGHTNESS_LIMITS.MAX}
        />
      )}

      <div className='w-full'>
        <div className='flex items-center justify-between p-2'>
          <span className='text-sm font-medium'>{_('Color')}</span>
        </div>
        <div
          className='flex gap-3 overflow-x-auto p-2'
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <style>{`
            .theme-scroll::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          {themes.map(({ name, label, colors }) => (
            <button
              key={name}
              onClick={() => setThemeColor(name)}
              className={clsx(
                'flex flex-shrink-0 flex-col items-center justify-center rounded-lg p-3 transition-all',
                'h-[40px] min-w-[80px]',
                themeColor === name
                  ? 'ring-primary ring-offset-base-200 ring-2 ring-offset-2'
                  : 'hover:opacity-80',
              )}
              style={{
                backgroundColor: isDarkMode ? colors.dark['base-100'] : colors.light['base-100'],
                color: isDarkMode ? colors.dark['base-content'] : colors.light['base-content'],
              }}
            >
              <span className='text-xs font-medium'>{_(label)}</span>
            </button>
          ))}
          <button
            onClick={() => cycleThemeMode()}
            className={clsx(
              'flex flex-shrink-0 flex-col items-center justify-center rounded-lg p-3 transition-all',
              'h-[40px] min-w-[80px]',
              themeMode === 'dark'
                ? 'ring-primary ring-offset-base-200 ring-2 ring-offset-2'
                : 'hover:opacity-80',
            )}
            style={{
              backgroundColor: (themes.find((t) => t.name === themeColor) || themes[0]!).colors
                .dark['base-100'],
              color: (themes.find((t) => t.name === themeColor) || themes[0]!).colors.dark[
                'base-content'
              ],
            }}
          >
            {themeMode === 'light' ? (
              <PiSun size={20} />
            ) : themeMode === 'dark' ? (
              <PiMoon size={20} />
            ) : (
              <TbSunMoon size={20} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
