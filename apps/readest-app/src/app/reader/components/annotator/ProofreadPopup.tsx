import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import { RiListSettingsLine } from 'react-icons/ri';
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
import { Toggle } from '@/components/primitives/toggle';
import { useThemeStore } from '@/store/themeStore';

// Light themes need the knob track inverted against the popup's base-300
// surface; dark themes already read correctly with the primitive's defaults.
const toggleClassName = (isDarkMode: boolean) =>
  clsx(
    'toggle-sm',
    !isDarkMode && 'checked:![--tglbg:theme(colors.base-100)] [--tglbg:theme(colors.base-300)]',
  );

interface ProofreadPopupProps {
  bookKey: string;
  selection?: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onConfirm?: (options: CreateProofreadRuleOptions) => void;
  onDismiss: () => void;
  onManage?: () => void;
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
  onManage,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getProgress, getView, recreateViewer } = useReaderStore();
  const { addRule } = useProofreadStore();
  const progress = getProgress(bookKey)!;
  const { isDarkMode } = useThemeStore();

  const [replacementText, setReplacementText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [wholeWord, setWholeWord] = useState(!isPunctuationOnly(selection?.text || ''));
  const [isRegex, setIsRegex] = useState(false);
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
      // A regex pattern defines its own boundaries, so the whole-word
      // validation (which inspects the literal selection) doesn't apply.
      const isValidWholeWord = isWholeWord(range, selection?.text || '');

      if (!isRegex && wholeWord && !isValidWholeWord) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Please select a whole word or uncheck the "Whole word" option.'),
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
        isRegex,
        enabled: true,
        caseSensitive,
        wholeWord: isRegex ? false : wholeWord,
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
        // `Popup` caps the height at the room above the selection, which can be
        // shorter than this form. Clip here and let the body scroll so nothing
        // paints past the rounded box.
        className='flex flex-col overflow-hidden rounded-lg'
        onDismiss={onDismiss}
      >
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-4 p-4'>
            <div className='flex items-center gap-2 text-xs text-base-content/70'>
              <span className='text-nowrap font-medium'>{_('Selected text:')}</span>
              <span className='line-clamp-1 flex-1 select-text break-words font-bold text-primary'>
                &quot;{selection?.text || ''}&quot;
              </span>
              {onManage && (
                <button
                  type='button'
                  onClick={onManage}
                  aria-label={_('Proofread Replacement Rules')}
                  title={_('Proofread Replacement Rules')}
                  className='shrink-0 rounded p-1 hover:bg-base-200 text-base-content/70 hover:text-base-content transition-colors'
                >
                  <RiListSettingsLine size={16} />
                </button>
              )}
            </div>

            <div className='flex items-center justify-between gap-2'>
              <label
                htmlFor='replacement-input'
                className='shrink-0 text-xs font-medium text-base-content/80'
              >
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
                className='bg-base-200 text-base-content placeholder:text-base-content/40 border-base-300 focus:border-primary focus:ring-primary eink-bordered w-full flex-1 rounded-md border p-2 text-sm transition-all focus:outline-none focus:ring-1'
              />
              <button
                onClick={handleApply}
                disabled={!replacementText}
                className='btn btn-sm btn-contrast shrink-0 font-medium px-2'
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
              <Toggle
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className={toggleClassName(isDarkMode)}
              />
            </label>

            <label
              className={clsx(
                'flex items-center gap-2',
                isRegex ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              )}
            >
              <span className='line-clamp-1 text-xs' title={_('Whole word:')}>
                {_('Whole word:')}
              </span>
              <Toggle
                className={toggleClassName(isDarkMode)}
                disabled={isRegex}
                checked={isRegex ? false : wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
              />
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <span className='line-clamp-1 text-xs' title={_('Regex:')}>
                {_('Regex:')}
              </span>

              <Toggle
                className={toggleClassName(isDarkMode)}
                checked={isRegex}
                onChange={(e) => setIsRegex(e.target.checked)}
              />
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <span className='line-clamp-1 text-xs' title={_('Only for TTS:')}>
                {_('Only for TTS:')}
              </span>
              <Toggle
                className={toggleClassName(isDarkMode)}
                disabled={scope === 'selection'}
                checked={onlyForTTS}
                onChange={(e) => setOnlyForTTS(e.target.checked)}
              />
            </label>
          </div>
        </div>
        {/* Pinned: the scope select stays reachable however tight the popup is. */}
        <div className='flex shrink-0 items-center justify-between gap-2 p-4'>
          <label
            htmlFor='scope-select'
            className='line-clamp-1 text-xs font-medium text-base-content/80'
            title={_('Scope:')}
          >
            {_('Scope:')}
          </label>
          <Select
            className='max-w-[85%]'
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
