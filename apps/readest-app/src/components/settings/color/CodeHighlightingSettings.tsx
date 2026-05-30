import React from 'react';
import { CODE_LANGUAGES, CodeLanguage } from '@/utils/highlightjs';
import { useTranslation } from '@/hooks/useTranslation';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from '../primitives';

interface CodeHighlightingSettingsProps {
  codeHighlighting: boolean;
  codeLanguage: string;
  onToggle: (enabled: boolean) => void;
  onLanguageChange: (language: CodeLanguage) => void;
  'data-setting-id'?: string;
}

const CodeHighlightingSettings: React.FC<CodeHighlightingSettingsProps> = ({
  codeHighlighting,
  codeLanguage,
  onToggle,
  onLanguageChange,
  'data-setting-id': dataSettingId,
}) => {
  const _ = useTranslation();

  return (
    <BoxedList title={_('Code Highlighting')} data-setting-id={dataSettingId}>
      <SettingsSwitchRow
        label={_('Enable Highlighting')}
        checked={codeHighlighting}
        onChange={() => onToggle(!codeHighlighting)}
      />
      <SettingsRow label={_('Code Language')}>
        <SettingsSelect
          value={codeLanguage}
          onChange={(event) => onLanguageChange(event.target.value as CodeLanguage)}
          ariaLabel={_('Code Language')}
          disabled={!codeHighlighting}
          options={CODE_LANGUAGES.map((lang) => ({
            value: lang,
            label: lang === 'auto-detect' ? _('Auto') : lang,
          }))}
        />
      </SettingsRow>
    </BoxedList>
  );
};

export default CodeHighlightingSettings;
