import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdSettings } from 'react-icons/md';

import {
  CJK_EXCLUDE_PATTENS,
  CJK_FONTS_PATTENS,
  CJK_SANS_SERIF_FONTS,
  CJK_SERIF_FONTS,
  IOS_FONTS,
  LINUX_FONTS,
  MACOS_FONTS,
  MONOSPACE_FONTS,
  NON_FREE_FONTS,
  SANS_SERIF_FONTS,
  SERIF_FONTS,
  WINDOWS_FONTS,
} from '@/services/constants';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { getOSPlatform, isCJKEnv } from '@/utils/misc';
import { getSysFontsList } from '@/utils/bridge';
import { isCJKStr } from '@/utils/lang';
import { isTauriAppPlatform } from '@/services/environment';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { saveViewSettings } from '@/helpers/settings';
import { SettingsPanelPanelProp } from './SettingsDialog';
import NumberInput from './NumberInput';
import FontDropdown from './FontDropDown';
import CustomFonts from './CustomFonts';

const genCJKFontsList = (sysFonts: string[]) => {
  return Array.from(new Set([...sysFonts, ...CJK_SERIF_FONTS, ...CJK_SANS_SERIF_FONTS]))
    .filter((font) => CJK_FONTS_PATTENS.test(font) || isCJKStr(font))
    .filter((font) => !CJK_EXCLUDE_PATTENS.test(font))
    .sort((a, b) => a.localeCompare(b));
};

const isSymbolicFontName = (font: string) =>
  /emoji|icons|symbol|dingbats|ornaments|webdings|wingdings|miuiex/i.test(font);

interface FontFaceProps {
  className?: string;
  family: string;
  label: string;
  options: string[];
  moreOptions?: string[];
  selected: string;
  onSelect: (option: string) => void;
}

const handleFontFaceFont = (option: string, family: string) => {
  return `'${option}', ${family}`;
};

const filterNonFreeFonts = (font: string) => {
  return !['android', 'linux'].includes(getOSPlatform()) || !NON_FREE_FONTS.includes(font);
};

const FontFace = ({
  className,
  family,
  label,
  options,
  moreOptions,
  selected,
  onSelect,
}: FontFaceProps) => {
  const _ = useTranslation();
  return (
    <div className={clsx('config-item', className)}>
      <span className='line-clamp-2 min-w-10'>{label}</span>
      <FontDropdown
        family={family}
        options={options.map((option) => ({ option, label: _(option) }))}
        moreOptions={moreOptions?.map((option) => ({ option, label: option })) ?? []}
        selected={selected}
        onSelect={onSelect}
        onGetFontFamily={handleFontFaceFont}
      />
    </div>
  );
};

const FontPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const { settings, fontPanelView, setFontPanelView } = useSettingsStore();
  const { fonts: allCustomFonts, getFontFamilies } = useCustomFontStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;
  const view = getView(bookKey);
  const iconSize18 = useResponsiveSize(18);

  const fontFamilyOptions = [
    {
      option: 'Serif',
      label: _('Serif Font'),
    },
    {
      option: 'Sans-serif',
      label: _('Sans-Serif Font'),
    },
  ];

  const osPlatform = getOSPlatform();
  let defaultSysFonts: string[] = [];
  switch (osPlatform) {
    case 'macos':
      defaultSysFonts = MACOS_FONTS;
      break;
    case 'windows':
      defaultSysFonts = WINDOWS_FONTS;
      break;
    case 'linux':
      defaultSysFonts = LINUX_FONTS;
      break;
    case 'ios':
      defaultSysFonts = IOS_FONTS;
      break;
    case 'android':
      defaultSysFonts = [];
      break;
    default:
      break;
  }
  const [sysFonts, setSysFonts] = useState<string[]>(defaultSysFonts);
  const [defaultFont, setDefaultFont] = useState(viewSettings.defaultFont);
  const [defaultFontSize, setDefaultFontSize] = useState(viewSettings.defaultFontSize);
  const [minFontSize, setMinFontSize] = useState(viewSettings.minimumFontSize);
  const [overrideFont, setOverrideFont] = useState(viewSettings.overrideFont);
  const [defaultCJKFont, setDefaultCJKFont] = useState(viewSettings.defaultCJKFont);
  const [serifFont, setSerifFont] = useState(viewSettings.serifFont);
  const [sansSerifFont, setSansSerifFont] = useState(viewSettings.sansSerifFont);
  const [monospaceFont, setMonospaceFont] = useState(viewSettings.monospaceFont);
  const [fontWeight, setFontWeight] = useState(viewSettings.fontWeight);

  const [customFonts, setCustomFonts] = useState<string[]>(getFontFamilies());
  const [CJKFonts, setCJKFonts] = useState<string[]>(() => {
    return genCJKFontsList([...customFonts, ...sysFonts]);
  });

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      defaultFont: setDefaultFont,
      defaultFontSize: setDefaultFontSize,
      minimumFontSize: setMinFontSize,
      overrideFont: setOverrideFont,
      defaultCJKFont: setDefaultCJKFont,
      serifFont: setSerifFont,
      sansSerifFont: setSansSerifFont,
      monospaceFont: setMonospaceFont,
      fontWeight: setFontWeight,
    });
  };

  const handleManageCustomFonts = () => {
    setFontPanelView('custom-fonts');
  };

  const handleBackToMain = () => {
    setFontPanelView('main-fonts');
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  useEffect(() => {
    setCJKFonts((prev) => {
      const newFonts = genCJKFontsList([...customFonts, ...sysFonts]);
      return prev.length !== newFonts.length ? newFonts : prev;
    });
  }, [customFonts, sysFonts]);

  useEffect(() => {
    setCustomFonts(getFontFamilies());
  }, [allCustomFonts, getFontFamilies]);

  useEffect(() => {
    setSerifFont(viewSettings.serifFont);
    setSansSerifFont(viewSettings.sansSerifFont);
    setMonospaceFont(viewSettings.monospaceFont);
  }, [viewSettings.serifFont, viewSettings.sansSerifFont, viewSettings.monospaceFont]);

  useEffect(() => {
    if (isTauriAppPlatform() && appService && !appService.isAndroidApp) {
      getSysFontsList().then((res) => {
        if (res.error || Object.keys(res.fonts).length === 0) {
          console.error('Failed to get system fonts list:', res.error);
          return;
        }
        const processedFonts: string[] = [];
        Object.entries(res.fonts).forEach(([fontName, fontFamily]) => {
          if (!fontName || isSymbolicFontName(fontName)) return;

          const fontsInFamily = Object.entries(res.fonts).filter(
            ([_, family]) => family === fontFamily,
          );

          if (fontsInFamily.length === 1) {
            processedFonts.push(fontFamily);
          } else {
            processedFonts.push(fontName);
          }
        });
        setSysFonts([...new Set(processedFonts)].sort((a, b) => a.localeCompare(b)));
      });
    }
  }, [appService]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'defaultFont', defaultFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFont]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'defaultCJKFont', defaultCJKFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCJKFont]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'defaultFontSize', defaultFontSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFontSize]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'minimumFontSize', minFontSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minFontSize]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'fontWeight', fontWeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontWeight]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'serifFont', serifFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serifFont]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'sansSerifFont', sansSerifFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sansSerifFont]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'monospaceFont', monospaceFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monospaceFont]);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'overrideFont', overrideFont);
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

  if (fontPanelView === 'custom-fonts') {
    return (
      <div className='my-4 w-full'>
        <CustomFonts bookKey={bookKey} onBack={handleBackToMain} />
      </div>
    );
  }

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='flex items-center justify-between'>
        <h2 className='font-medium'>{_('Override Book Font')}</h2>
        <input
          type='checkbox'
          className='toggle'
          checked={overrideFont}
          onChange={() => setOverrideFont(!overrideFont)}
        />
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Font Size')}</h2>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <NumberInput
              label={_('Default Font Size')}
              value={defaultFontSize}
              onChange={setDefaultFontSize}
              min={minFontSize}
              max={120}
            />
            <NumberInput
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
        <h2 className='mb-2 font-medium'>{_('Font Weight')}</h2>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <NumberInput
              label={_('Font Weight')}
              value={fontWeight}
              onChange={setFontWeight}
              min={100}
              max={900}
              step={100}
            />
          </div>
        </div>
      </div>

      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('Font Family')}</h2>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span className=''>{_('Default Font')}</span>
              <FontDropdown
                options={fontFamilyOptions}
                selected={defaultFont}
                onSelect={setDefaultFont}
                onGetFontFamily={handleFontFamilyFont}
              />
            </div>

            {(isCJKEnv() || view?.language.isCJK) && (
              <FontFace
                className='config-item-top'
                family='serif'
                label={_('CJK Font')}
                options={CJKFonts}
                selected={defaultCJKFont}
                onSelect={setDefaultCJKFont}
              />
            )}
          </div>
        </div>
      </div>

      <div className='w-full'>
        <div className='mb-2 flex items-center justify-between'>
          <h2 className='font-medium'>{_('Font Face')}</h2>
          <button
            onClick={handleManageCustomFonts}
            className='btn btn-ghost btn-xs gap-1 hover:bg-transparent'
            title={_('Manage Custom Fonts')}
          >
            <MdSettings size={iconSize18} />
          </button>
        </div>
        <div className='card border-base-200 border shadow'>
          <div className='divide-base-200 divide-y'>
            <FontFace
              className='config-item-top'
              family='serif'
              label={_('Serif Font')}
              options={[
                ...customFonts,
                ...SERIF_FONTS.filter(filterNonFreeFonts),
                ...CJK_SERIF_FONTS,
              ]}
              moreOptions={sysFonts}
              selected={serifFont}
              onSelect={setSerifFont}
            />
            <FontFace
              family='sans-serif'
              label={_('Sans-Serif Font')}
              options={[
                ...customFonts,
                ...SANS_SERIF_FONTS.filter(filterNonFreeFonts),
                ...CJK_SANS_SERIF_FONTS,
              ]}
              moreOptions={sysFonts}
              selected={sansSerifFont}
              onSelect={setSansSerifFont}
            />
            <FontFace
              className='config-item-bottom'
              family='monospace'
              label={_('Monospace Font')}
              options={[...customFonts, ...MONOSPACE_FONTS]}
              moreOptions={sysFonts}
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
