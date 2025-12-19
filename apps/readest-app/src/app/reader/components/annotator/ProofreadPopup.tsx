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
import { isWholeWord } from '@/utils/word';
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
  const [scope, setScope] = useState<ProofreadScope>('selection');

  const inputRef = useRef<HTMLInputElement>(null);
  useAutoFocus<HTMLInputElement>({ ref: inputRef });

  const handleScopeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setScope(event.target.value as ProofreadScope);
  };

  const handleApply = async () => {
    if (!selection) return;

    const range = selection?.range;

    if (range) {
      const isValidWholeWord = isWholeWord(range, selection?.text || '');

      if (!isValidWholeWord) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: `Cannot replace "${selection.text}" - please select a complete word. Partial word selections (like "and" in "England" or "errand") are not supported.`,
          timeout: 5000,
        });
        return;
      }

      if (scope === 'selection') {
        range.deleteContents();
        const textNode = document.createTextNode(replacementText);
        range.insertNode(textNode);
      }

      const options = {
        scope,
        pattern: selection.text,
        replacement: replacementText.trim(),
        cfi: selection.cfi,
        sectionHref: progress?.sectionHref,
        isRegex: false,
        enabled: true,
        caseSensitive,
        wholeWord: true,
      };
      onConfirm?.(options);

      await addRule(envConfig, bookKey, options);

      onDismiss();

      if (scope !== 'selection') {
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
        className='flex flex-col justify-between rounded-lg bg-gray-700 text-gray-400'
        triangleClassName='text-gray-700'
        onDismiss={onDismiss}
      >
        <div className='flex flex-col gap-6 p-4'>
          <div className='flex gap-1 text-xs text-gray-400'>
            <span>{_('Selected text:')}</span>
            <span className='line-clamp-1 select-text break-words text-yellow-300'>
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
              onChange={(e) => setReplacementText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && replacementText.trim()) {
                  handleApply();
                }
              }}
              placeholder={_('Enter text...')}
              className='w-full flex-1 rounded-md bg-gray-600 p-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-0'
            />
            <button
              onClick={handleApply}
              disabled={!replacementText.trim()}
              className={clsx(
                'btn btn-sm btn-ghost text-blue-600 disabled:text-gray-600',
                'bg-transparent hover:bg-transparent disabled:bg-transparent',
              )}
            >
              {_('Apply')}
            </button>
          </div>
        </div>

        <div className='flex items-center justify-between gap-4 p-4'>
          <label className='flex max-w-[30%] cursor-pointer items-center gap-2'>
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

          <div className='flex max-w-[65%] flex-1 items-center justify-between gap-2'>
            <label htmlFor='scope-select' className='line-clamp-1 text-xs' title={_('Scope:')}>
              {_('Scope:')}
            </label>
            <Select
              className='max-w-[50%] bg-gray-600 text-white'
              value={scope}
              onChange={handleScopeChange}
              options={scopeOptions}
            />
          </div>
        </div>
      </Popup>
    </div>
  );
};

export default ProofreadPopup;
