import React, { useState, useEffect } from 'react';
import { MdOutlineLightMode, MdOutlineDarkMode } from 'react-icons/md';
import { MdRadioButtonUnchecked, MdRadioButtonChecked } from 'react-icons/md';
import { CgColorPicker } from 'react-icons/cg';
import { TbSunMoon } from 'react-icons/tb';
import { PiPlus } from 'react-icons/pi';
import {
  applyCustomTheme,
  CustomTheme,
  generateDarkPalette,
  generateLightPalette,
  Theme,
  themes,
} from '@/styles/themes';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useResetViewSettings } from '../../hooks/useResetSettings';
import { saveViewSettings } from '../../utils/viewSettingsHelper';
import { CODE_LANGUAGES, CodeLanguage, manageSyntaxHighlighting } from '@/utils/highlightjs';
import { SettingsPanelPanelProp } from './SettingsDialog';
import Select from '@/components/Select';
import ThemeEditor from './ThemeEditor';

const ColorPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor, saveCustomTheme } =
    useThemeStore();
  const { envConfig } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const { getView, getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey)!;
  const [invertImgColorInDark, setInvertImgColorInDark] = useState(
    viewSettings.invertImgColorInDark,
  );

  const iconSize16 = useResponsiveSize(16);
  const iconSize24 = useResponsiveSize(24);
  const [editTheme, setEditTheme] = useState<CustomTheme | null>(null);
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [showCustomThemeEditor, setShowCustomThemeEditor] = useState(false);
  const [overrideColor, setOverrideColor] = useState(viewSettings.overrideColor!);
  const [codeHighlighting, setcodeHighlighting] = useState(viewSettings.codeHighlighting!);
  const [codeLanguage, setCodeLanguage] = useState(viewSettings.codeLanguage!);

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      overrideColor: setOverrideColor,
      invertImgColorInDark: setInvertImgColorInDark,
      codeHighlighting: setcodeHighlighting,
      codeLanguage: setCodeLanguage,
    });
    setThemeColor('default');
    setThemeMode('auto');
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (invertImgColorInDark === viewSettings.invertImgColorInDark) return;
    saveViewSettings(envConfig, bookKey, 'invertImgColorInDark', invertImgColorInDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invertImgColorInDark]);

  useEffect(() => {
    if (overrideColor === viewSettings.overrideColor) return;
    saveViewSettings(envConfig, bookKey, 'overrideColor', overrideColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideColor]);

  useEffect(() => {
    let update = false; // check if we need to update syntax highlighting
    if (codeHighlighting !== viewSettings.codeHighlighting) {
      saveViewSettings(envConfig, bookKey, 'codeHighlighting', codeHighlighting);
      update = true;
    }
    if (codeLanguage !== viewSettings.codeLanguage) {
      saveViewSettings(envConfig, bookKey, 'codeLanguage', codeLanguage);
      update = true;
    }
    if (!update) return;
    const view = getView(bookKey);
    if (!view) return;
    const docs = view.renderer.getContents();
    docs.forEach(({ doc }) => manageSyntaxHighlighting(doc, viewSettings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeHighlighting, codeLanguage]);

  useEffect(() => {
    const customThemes = settings.globalReadSettings.customThemes ?? [];
    setCustomThemes(
      customThemes.map((customTheme) => ({
        name: customTheme.name,
        label: customTheme.label,
        colors: {
          light: generateLightPalette(customTheme.colors.light),
          dark: generateDarkPalette(customTheme.colors.dark),
        },
        isCustomizale: true,
      })),
    );
  }, [settings]);

  const handleSaveCustomTheme = (customTheme: CustomTheme) => {
    applyCustomTheme(customTheme);
    saveCustomTheme(envConfig, settings, customTheme);

    setSettings({ ...settings });
    setThemeColor(customTheme.name);
    setShowCustomThemeEditor(false);
  };

  const handleDeleteCustomTheme = (customTheme: CustomTheme) => {
    saveCustomTheme(envConfig, settings, customTheme, true);

    setSettings({ ...settings });
    setThemeColor('default');
    setShowCustomThemeEditor(false);
  };

  const handleEditTheme = (name: string) => {
    const customTheme = settings.globalReadSettings.customThemes.find((t) => t.name === name);
    if (customTheme) {
      setEditTheme(customTheme);
      setShowCustomThemeEditor(true);
    }
  };

  return (
    <div className='my-4 w-full space-y-6'>
      {showCustomThemeEditor ? (
        <ThemeEditor
          customTheme={editTheme}
          onSave={handleSaveCustomTheme}
          onDelete={handleDeleteCustomTheme}
          onCancel={() => setShowCustomThemeEditor(false)}
        />
      ) : (
        <>
          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>{_('Theme Mode')}</h2>
            <div className='flex gap-4'>
              <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Auto Mode')}>
                <button
                  className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'auto' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setThemeMode('auto')}
                >
                  <TbSunMoon />
                </button>
              </div>
              <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Light Mode')}>
                <button
                  className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'light' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setThemeMode('light')}
                >
                  <MdOutlineLightMode />
                </button>
              </div>
              <div className='lg:tooltip lg:tooltip-bottom' data-tip={_('Dark Mode')}>
                <button
                  className={`btn btn-ghost btn-circle btn-sm ${themeMode === 'dark' ? 'btn-active bg-base-300' : ''}`}
                  onClick={() => setThemeMode('dark')}
                >
                  <MdOutlineDarkMode />
                </button>
              </div>
            </div>
          </div>

          <div className='flex items-center justify-between'>
            <h2 className='font-medium'>{_('Invert Image In Dark Mode')}</h2>
            <input
              type='checkbox'
              className='toggle'
              checked={invertImgColorInDark}
              disabled={!isDarkMode}
              onChange={() => setInvertImgColorInDark(!invertImgColorInDark)}
            />
          </div>

          <div className='flex items-center justify-between'>
            <h2 className=''>{_('Override Book Color')}</h2>
            <input
              type='checkbox'
              className='toggle'
              checked={overrideColor}
              onChange={() => setOverrideColor(!overrideColor)}
            />
          </div>

          <div>
            <h2 className='mb-2 font-medium'>{_('Theme Color')}</h2>
            <div className='grid grid-cols-3 gap-4'>
              {themes.concat(customThemes).map(({ name, label, colors, isCustomizale }) => (
                <label
                  key={name}
                  className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg p-4 shadow-md ${
                    themeColor === name ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
                  }`}
                  style={{
                    backgroundColor: isDarkMode
                      ? colors.dark['base-100']
                      : colors.light['base-100'],
                    color: isDarkMode ? colors.dark['base-content'] : colors.light['base-content'],
                  }}
                >
                  <input
                    type='radio'
                    name='theme'
                    value={name}
                    checked={themeColor === name}
                    onChange={() => setThemeColor(name)}
                    className='hidden'
                  />
                  {themeColor === name ? (
                    <MdRadioButtonChecked size={iconSize24} />
                  ) : (
                    <MdRadioButtonUnchecked size={iconSize24} />
                  )}
                  <span>{_(label)}</span>
                  {isCustomizale && themeColor === name && (
                    <button onClick={() => handleEditTheme(name)}>
                      <CgColorPicker size={iconSize16} className='absolute right-2 top-2' />
                    </button>
                  )}
                </label>
              ))}
              <label
                className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-4 shadow-md`}
                onClick={() => setShowCustomThemeEditor(true)}
              >
                <PiPlus size={iconSize24} />
                <span>{_('Custom')}</span>
              </label>
            </div>
          </div>

          <div className='w-full'>
            <h2 className='mb-2 font-medium'>{_('Code Highlighting')}</h2>
            <div className='card border-base-200 bg-base-100 border shadow'>
              <div className='divide-base-200'>
                <div className='config-item'>
                  <span className=''>{_('Enable Highlighting')}</span>
                  <input
                    type='checkbox'
                    className='toggle'
                    checked={codeHighlighting}
                    onChange={() => setcodeHighlighting(!codeHighlighting)}
                  />
                </div>

                <div className='config-item'>
                  <span className=''>{_('Code Language')}</span>
                  <Select
                    value={codeLanguage}
                    onChange={(event) => setCodeLanguage(event.target.value as CodeLanguage)}
                    options={CODE_LANGUAGES.map((lang) => ({
                      value: lang,
                      label: lang,
                    }))}
                    disabled={!codeHighlighting}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ColorPanel;
