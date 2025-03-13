import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { CustomTheme } from '@/styles/themes';
import { md5Fingerprint } from '@/utils/md5';
import { CUSTOM_THEME_TEMPLATES } from '@/services/constants';
import { useSettingsStore } from '@/store/settingsStore';
import clsx from 'clsx';
import ColorInput from './ColorInput';

type ThemeEditorProps = {
  customTheme: CustomTheme | null;
  onSave: (customTheme: CustomTheme) => void;
  onDelete: (customTheme: CustomTheme) => void;
  onCancel: () => void;
};

const ThemeEditor: React.FC<ThemeEditorProps> = ({ customTheme, onSave, onDelete, onCancel }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const template =
    CUSTOM_THEME_TEMPLATES[Math.floor(Math.random() * CUSTOM_THEME_TEMPLATES.length)]!;
  const [lightTextColor, setLightTextColor] = useState(
    customTheme?.colors.light.fg || template.light.fg,
  );
  const [lightBackgroundColor, setLightBackgroundColor] = useState(
    customTheme?.colors.light.bg || template.light.bg,
  );
  const [darkTextColor, setDarkTextColor] = useState(
    customTheme?.colors.dark.fg || template.dark.fg,
  );
  const [darkBackgroundColor, setDarkBackgroundColor] = useState(
    customTheme?.colors.dark.bg || template.dark.bg,
  );

  const [themeName, setThemeName] = useState(customTheme?.label || _('Custom'));

  const ThemePreview: React.FC<{
    textColor: string;
    backgroundColor: string;
    label: string;
  }> = ({ textColor, backgroundColor, label }) => (
    <div className='mb-2 mt-4'>
      <label className='mb-1 block text-sm font-medium'>{label}</label>
      <div
        className='border-base-300 overflow-hidden rounded border p-3'
        style={{
          backgroundColor: backgroundColor,
          color: textColor,
        }}
      >
        <p className='mb-2 whitespace-pre-line text-sm'>
          {_(
            "All the world's a stage,\nAnd all the men and women merely players;\nThey have their exits and their entrances,\nAnd one man in his time plays many parts,\nHis acts being seven ages.\n\n— William Shakespeare",
          )}
        </p>
      </div>
    </div>
  );

  const getCustomTheme = () => {
    return {
      name: md5Fingerprint(themeName),
      label: themeName,
      colors: {
        light: {
          fg: lightTextColor,
          bg: lightBackgroundColor,
          primary: '#3b82f6',
        },
        dark: {
          fg: darkTextColor,
          bg: darkBackgroundColor,
          primary: '#60a5fa',
        },
      },
    };
  };

  return (
    <div className='mt-6 rounded-lg'>
      <div className='mb-4'>
        <div className='mb-4 flex items-center justify-between'>
          <label className='font-medium'>{_('Custom Theme')}</label>
          <div className='flex w-[calc(50%-12px)] justify-between'>
            <button
              className='btn btn-ghost btn-sm text-base-content px-2'
              onClick={() => onSave(getCustomTheme())}
            >
              {_('Save')}
            </button>

            <button
              className={clsx(
                'btn btn-ghost btn-sm px-2',
                !settings.globalReadSettings.customThemes.find(
                  (theme) => theme.name === md5Fingerprint(themeName),
                ) && 'btn-disabled',
              )}
              onClick={() => onDelete(getCustomTheme())}
            >
              {_('Delete')}
            </button>

            <button className='btn btn-ghost btn-sm px-2' onClick={onCancel}>
              {_('Cancel')}
            </button>
          </div>
        </div>
        <div className='mb-4 flex items-center justify-between'>
          <label className='font-medium'>{_('Theme Name')}</label>
          <input
            type='text'
            value={themeName}
            onChange={(e) => setThemeName(e.target.value)}
            className='bg-base-100 text-base-content border-base-200 w-[calc(50%-12px)] rounded border p-2 text-sm'
          />
        </div>
      </div>

      <div className='grid grid-cols-2 gap-6'>
        <div className='bg-base-200 rounded-lg p-3'>
          <h3 className='mb-3 text-center font-medium'>{_('Light Mode')}</h3>

          <ColorInput label={_('Text Color')} value={lightTextColor} onChange={setLightTextColor} />

          <ColorInput
            label={_('Background Color')}
            value={lightBackgroundColor}
            onChange={setLightBackgroundColor}
          />

          <ThemePreview
            textColor={lightTextColor}
            backgroundColor={lightBackgroundColor}
            label={_('Preview')}
          />
        </div>

        <div className='bg-base-300 rounded-lg p-3'>
          <h3 className='mb-3 text-center font-medium'>{_('Dark Mode')}</h3>

          <ColorInput label={_('Text Color')} value={darkTextColor} onChange={setDarkTextColor} />

          <ColorInput
            label={_('Background Color')}
            value={darkBackgroundColor}
            onChange={setDarkBackgroundColor}
          />

          <ThemePreview
            textColor={darkTextColor}
            backgroundColor={darkBackgroundColor}
            label={_('Preview')}
          />
        </div>
      </div>
    </div>
  );
};

export default ThemeEditor;
