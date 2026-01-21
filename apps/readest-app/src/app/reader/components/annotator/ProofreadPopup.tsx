import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { CreateProofreadRuleOptions, useProofreadStore } from '@/store/proofreadStore';
import { ProofreadScope } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { Position, TextSelection } from '@/utils/sel';
import { isPunctuationOnly, isWholeWord } from '@/utils/word';
import Select from '@/components/Select';
import Popup from '@/components/Popup';

interface ProofreadPopupProps {
  bookKey: string;
  selection?: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onConfirm?: (options: CreateProofreadRuleOptions) => void;
  onDismiss: () => void;
}

const ProofreadPopup: React.FC<ProofreadPopupProps> = ({
  bookKey,
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onConfirm,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getProgress, getView, recreateViewer } = useReaderStore();
  const { addRule } = useProofreadStore();
  const progress = getProgress(bookKey)!;

  const [replacementText, setReplacementText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [wholeWord, setWholeWord] = useState(!isPunctuationOnly(selection?.text || ''));
  const [scope, setScope] = useState<ProofreadScope>('selection');
  const [onlyForTTS, setOnlyForTTS] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  useAutoFocus<HTMLInputElement>({ ref: inputRef });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setReplacementText(text);
  };

  const handleScopeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setScope(event.target.value as ProofreadScope);
  };

  const handleApply = async () => {
    if (!selection) return;

    const range = selection?.range;

    if (range) {
      const isValidWholeWord = isWholeWord(range, selection?.text || '');

      if (wholeWord && !isValidWholeWord) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: 'Please select a whole word or uncheck the "Whole word" option.',
          timeout: 5000,
        });
        return;
      }

      if (scope === 'selection') {
        range.deleteContents();
        const textNode = document.createTextNode(replacementText);
        range.insertNode(textNode);
      }

      const options: CreateProofreadRuleOptions = {
        scope,
        pattern: selection.text,
        replacement: replacementText.trim(),
        cfi: selection.cfi,
        sectionHref: progress?.sectionHref,
        isRegex: false,
        enabled: true,
        caseSensitive,
        wholeWord: wholeWord,
        onlyForTTS: scope !== 'selection' ? onlyForTTS : undefined,
      };
      onConfirm?.(options);

      await addRule(envConfig, bookKey, options);

      onDismiss();

      if (scope !== 'selection' && !onlyForTTS) {
        if (getView(bookKey)) {
          recreateViewer(envConfig, bookKey);
        }
      }
    }
  };

  const scopeOptions = [
    { value: 'selection', label: _('Current selection') },
    { value: 'book', label: _('All occurrences in this book') },
    { value: 'library', label: _('All occurrences in your library') },
  ];

  return (
    <div>
      <Popup
        trianglePosition={trianglePosition}
        width={popupWidth}
        minHeight={popupHeight}
        position={position}
        className='not-eink:text-gray-400 flex flex-col justify-between rounded-lg bg-gray-700'
        triangleClassName='text-gray-700'
        onDismiss={onDismiss}
      >
        <div className='flex flex-col gap-6 p-4'>
          <div className='not-eink:text-gray-400 flex gap-1 text-xs'>
            <span className='text-nowrap'>{_('Selected text:')}</span>
            <span className='not-eink:text-yellow-300 line-clamp-1 select-text break-words font-medium'>
              &quot;{selection?.text || ''}&quot;
            </span>
          </div>

          <div className='flex items-center justify-between gap-2'>
            <label htmlFor='replacement-input' className='text-xs'>
              {_('Replace with:')}
            </label>
            <input
              ref={inputRef}
              type='text'
              value={replacementText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && replacementText) {
                  handleApply();
                }
              }}
              placeholder={_('Enter text...')}
              className={clsx(
                'w-full flex-1 rounded-md p-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-0',
                'not-eink:bg-gray-600 not-eink:text-white eink:border eink:border-base-content',
              )}
            />
            <button
              onClick={handleApply}
              disabled={!replacementText}
              className={clsx(
                'btn btn-sm btn-ghost btn-primary disabled:text-base-content/75 text-blue-600 disabled:opacity-75',
                'bg-transparent hover:bg-transparent disabled:bg-transparent',
              )}
            >
              {_('Apply')}
            </button>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-4 p-4'>
          <label className='flex cursor-pointer items-center gap-2'>
            <span className='line-clamp-1 text-xs' title={_('Case sensitive:')}>
              {_('Case sensitive:')}
            </span>
            <input
              type='checkbox'
              className='toggle toggle-sm bg-gray-500 checked:bg-black hover:bg-gray-500 hover:checked:bg-black'
              style={
                {
                  '--tglbg': '#4B5563',
                } as React.CSSProperties
              }
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
          </label>

          <label className='flex cursor-pointer items-center gap-2'>
            <span className='line-clamp-1 text-xs' title={_('Whole word:')}>
              {_('Whole word:')}
            </span>
            <input
              type='checkbox'
              className='toggle toggle-sm bg-gray-500 checked:bg-black hover:bg-gray-500 hover:checked:bg-black'
              style={
                {
                  '--tglbg': '#4B5563',
                } as React.CSSProperties
              }
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
            />
          </label>

          <label className='flex cursor-pointer items-center gap-2'>
            <span className='line-clamp-1 text-xs' title={_('Only for TTS:')}>
              {_('Only for TTS:')}
            </span>
            <input
              type='checkbox'
              disabled={scope === 'selection'}
              className='toggle toggle-sm bg-gray-500 checked:bg-black hover:bg-gray-500 hover:checked:bg-black'
              style={
                {
                  '--tglbg': '#4B5563',
                } as React.CSSProperties
              }
              checked={onlyForTTS}
              onChange={(e) => setOnlyForTTS(e.target.checked)}
            />
          </label>
        </div>
        <div className='flex flex-1 items-center justify-between gap-2 p-4'>
          <label htmlFor='scope-select' className='line-clamp-1 text-xs' title={_('Scope:')}>
            {_('Scope:')}
          </label>
          <Select
            className='not-eink:bg-gray-600 eink:bg-base-100 not-eink:text-white max-w-[85%]'
            value={scope}
            onChange={handleScopeChange}
            options={scopeOptions}
          />
        </div>
      </Popup>
    </div>
  );
};

export default ProofreadPopup;
