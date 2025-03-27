import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import {
  ANDROID_FONTS,
  IOS_FONTS,
  LINUX_FONTS,
  MACOS_FONTS,
  MONOSPACE_FONTS,
  SANS_SERIF_FONTS,
  SERIF_FONTS,
  WINDOWS_FONTS,
} from '@/services/constants';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { getOSPlatform } from '@/utils/misc';
import { getSysFontsList } from '@/utils/font';
import { isTauriAppPlatform } from '@/services/environment';
import { saveViewSettings } from '../../utils/viewSettingsHelper';
import NumberInput from './NumberInput';
import FontDropdown from './FontDropDown';

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
      <span className=''>{label}</span>
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

const FontPanel: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;

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
      defaultSysFonts = ANDROID_FONTS;
      break;
    default:
      break;
  }
  const [sysFonts, setSysFonts] = useState<string[]>(defaultSysFonts);
  const [defaultFontSize, setDefaultFontSize] = useState(viewSettings.defaultFontSize!);
  const [minFontSize, setMinFontSize] = useState(viewSettings.minimumFontSize!);
  const [overrideFont, setOverrideFont] = useState(viewSettings.overrideFont!);
  const [defaultFont, setDefaultFont] = useState(viewSettings.defaultFont!);
  const [serifFont, setSerifFont] = useState(viewSettings.serifFont!);
  const [sansSerifFont, setSansSerifFont] = useState(viewSettings.sansSerifFont!);
  const [monospaceFont, setMonospaceFont] = useState(viewSettings.monospaceFont!);
  const [fontWeight, setFontWeight] = useState(viewSettings.fontWeight!);

  useEffect(() => {
    if (isTauriAppPlatform() && appService?.hasSysFontsList) {
      getSysFontsList().then((fonts) => {
        setSysFonts(fonts);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveViewSettings(envConfig, bookKey, 'defaultFont', defaultFont);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFont]);

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

  return (
    <div className='my-4 w-full space-y-6'>
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

            <div className='config-item'>
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
              moreOptions={sysFonts}
              selected={serifFont}
              onSelect={setSerifFont}
            />
            <FontFace
              family='sans-serif'
              label={_('Sans-Serif Font')}
              options={SANS_SERIF_FONTS}
              moreOptions={sysFonts}
              selected={sansSerifFont}
              onSelect={setSansSerifFont}
            />
            <FontFace
              className='config-item-bottom'
              family='monospace'
              label={_('Monospace Font')}
              options={MONOSPACE_FONTS}
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
