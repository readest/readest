import React from 'react';
import { CODE_LANGUAGES, CodeLanguage } from '@/utils/highlightjs';
import { useTranslation } from '@/hooks/useTranslation';
import Select from '@/components/Select';

interface CodeHighlightingSettingsProps {
  codeHighlighting: boolean;
  codeLanguage: string;
  onToggle: (enabled: boolean) => void;
  onLanguageChange: (language: CodeLanguage) => void;
}

const CodeHighlightingSettings: React.FC<CodeHighlightingSettingsProps> = ({
  codeHighlighting,
  codeLanguage,
  onToggle,
  onLanguageChange,
}) => {
  const _ = useTranslation();

  return (
    <div className='w-full'>
      <h2 className='mb-2 font-medium'>{_('Code Highlighting')}</h2>
      <div className='card border-base-200 bg-base-100 border shadow'>
        <div className='divide-base-200'>
          <div className='config-item'>
            <span>{_('Enable Highlighting')}</span>
            <input
              type='checkbox'
              className='toggle'
              checked={codeHighlighting}
              onChange={() => onToggle(!codeHighlighting)}
            />
          </div>

          <div className='config-item'>
            <span>{_('Code Language')}</span>
            <Select
              value={codeLanguage}
              onChange={(event) => onLanguageChange(event.target.value as CodeLanguage)}
              options={CODE_LANGUAGES.map((lang) => ({
                value: lang,
                label: lang === 'auto-detect' ? _('Auto') : lang,
              }))}
              disabled={!codeHighlighting}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodeHighlightingSettings;
