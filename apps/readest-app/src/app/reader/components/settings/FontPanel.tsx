import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import NumberInput from './NumberInput';
import FontDropdown from './FontDropDown';
import {
  LINUX_FONTS,
  MACOS_FONTS,
  MONOSPACE_FONTS,
  SANS_SERIF_FONTS,
  SERIF_FONTS,
  WINDOWS_FONTS,
} from '@/services/constants';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useTheme } from '@/hooks/useTheme';
import { getStyles } from '@/utils/style';
import { getOSPlatform } from '@/utils/misc';

interface FontFaceProps {
  className?: string;
  family: string;
  label: string;
  options: string[];
  moreOptions?: string[];
  selected: string;
  onSelect: (option: string) => void;
}

const fontFamilyOptions = ['Serif', 'Sans-serif'];

const handleFontFaceFont = (option: string, family: string) => {
  return `'${option}', ${family}`;
};

const FontFace = ({
  className,
  family,
  label,
  options,
  moreOptions,
  selected,
  onSelect,
}: FontFaceProps) => (
  <div className={clsx('config-item', className)}>
    <span className=''>{label}</span>
    <FontDropdown
      family={family}
      options={options}
      moreOptions={moreOptions}
      selected={selected}
      onSelect={onSelect}
      onGetFontFamily={handleFontFaceFont}
    />
  </div>
);

const FontPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings, isFontLayoutSettingsGlobal, setSettings } = useSettingsStore();
  const { getView, getViewSettings, setViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey)!;
  const { themeCode } = useTheme();

  const osPlatform = getOSPlatform();
  let moreFonts: string[] = [];
  switch (osPlatform) {
    case 'macos':
      moreFonts = MACOS_FONTS;
      break;
    case 'windows':
      moreFonts = WINDOWS_FONTS;
      break;
    case 'linux':
      moreFonts = LINUX_FONTS;
      break;
    default:
      break;
  }
  const [defaultFontSize, setDefaultFontSize] = useState(viewSettings.defaultFontSize!);
  const [minFontSize, setMinFontSize] = useState(viewSettings.minimumFontSize!);
  const [overrideFont, setOverrideFont] = useState(viewSettings.overrideFont!);
  const [defaultFont, setDefaultFont] = useState(viewSettings.defaultFont!);
  const [serifFont, setSerifFont] = useState(viewSettings.serifFont!);
  const [sansSerifFont, setSansSerifFont] = useState(viewSettings.sansSerifFont!);
  const [monospaceFont, setMonospaceFont] = useState(viewSettings.monospaceFont!);

  useEffect(() => {
    viewSettings.defaultFont = defaultFont;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.defaultFont = defaultFont;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFont]);

  useEffect(() => {
    viewSettings.defaultFontSize = defaultFontSize;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.defaultFontSize = defaultFontSize;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFontSize]);

  useEffect(() => {
    viewSettings.minimumFontSize = minFontSize;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.minimumFontSize = minFontSize;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minFontSize]);

  useEffect(() => {
    viewSettings.serifFont = serifFont;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.serifFont = serifFont;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serifFont]);

  useEffect(() => {
    viewSettings.sansSerifFont = sansSerifFont;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.sansSerifFont = sansSerifFont;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sansSerifFont]);

  useEffect(() => {
    viewSettings.monospaceFont = monospaceFont;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.monospaceFont = monospaceFont;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monospaceFont]);

  useEffect(() => {
    viewSettings.overrideFont = overrideFont;
    setViewSettings(bookKey, viewSettings);
    if (isFontLayoutSettingsGlobal) {
      settings.globalViewSettings.overrideFont = overrideFont;
      setSettings(settings);
    }
    view?.renderer.setStyles?.(getStyles(viewSettings, themeCode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideFont]);

  const handleFontFamilyFont = (option: string) => {
    switch (option) {
      case 'Serif':
        return `'${serifFont}', serif`;
      case 'Sans-serif':
        return `'${sansSerifFont}', sans-serif`;
      case 'Monospace':
        return `'${monospaceFont}', monospace`;
      default:
        return '';
    }
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Font Size')}</h2>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <NumberInput
              className='config-item-top'
              label={_('Default Font Size')}
              value={defaultFontSize}
              onChange={setDefaultFontSize}
              min={minFontSize}
              max={120}
            />
            <NumberInput
              className='config-item-bottom'
              label={_('Minimum Font Size')}
              value={minFontSize}
              onChange={setMinFontSize}
              min={1}
              max={120}
            />
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Font Family')}</h2>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item config-item-top'>
              <span className=''>{_('Default Font')}</span>
              <FontDropdown
                options={fontFamilyOptions}
                selected={defaultFont}
                onSelect={setDefaultFont}
                onGetFontFamily={handleFontFamilyFont}
              />
            </div>

            <div className='config-item config-item-bottom'>
              <span className=''>{_('Override Book Font')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={overrideFont}
                onChange={() => setOverrideFont(!overrideFont)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Font Face')}</h2>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <FontFace
              className='config-item-top'
              family='serif'
              label={_('Serif Font')}
              options={SERIF_FONTS}
              moreOptions={moreFonts}
              selected={serifFont}
              onSelect={setSerifFont}
            />
            <FontFace
              family='sans-serif'
              label={_('Sans-Serif Font')}
              options={SANS_SERIF_FONTS}
              moreOptions={moreFonts}
              selected={sansSerifFont}
              onSelect={setSansSerifFont}
            />
            <FontFace
              className='config-item-bottom'
              family='monospace'
              label={_('Monospace Font')}
              options={MONOSPACE_FONTS}
              moreOptions={moreFonts}
              selected={monospaceFont}
              onSelect={setMonospaceFont}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FontPanel;
