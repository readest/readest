import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdAdd } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import {
  ensureCustomTranslatorsLoaded,
  useCustomTranslatorStore,
} from '@/store/customTranslatorStore';
import { DEFAULT_PROMPT_ID, DEFAULT_TRANSLATION_PROMPT } from '@/services/translators/custom';
import type { TranslationPrompt } from '@/types/translation';
import { BoxedList, NavigationRow, SettingLabel, Tips } from './primitives';
import SubPageHeader from './SubPageHeader';
import CustomTranslatorEditor from './CustomTranslatorEditor';

type Page =
  | { kind: 'list' }
  | { kind: 'translator'; id?: string }
  | { kind: 'prompt'; id?: string; template?: string };

const AddButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type='button'
    onClick={onClick}
    className={clsx(
      'eink-bordered group flex h-11 items-center justify-center gap-2.5',
      'border-base-200 bg-base-100 rounded-lg border px-4',
      'text-base-content text-sm font-medium',
      'transition-colors duration-150',
      'hover:border-base-300 hover:bg-base-300/40',
      'active:bg-base-200/80',
      'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
    )}
  >
    <span
      className={clsx(
        'eink-inverted',
        'flex h-5 w-5 items-center justify-center rounded-full',
        'bg-base-200 text-base-content/60',
        'transition-colors duration-150',
        'group-hover:bg-base-content group-hover:text-base-100',
      )}
    >
      <MdAdd className='h-3.5 w-3.5' />
    </span>
    <span className='line-clamp-1'>{label}</span>
  </button>
);

interface PromptEditorProps {
  prompt?: TranslationPrompt;
  /** Initial text for a new prompt (e.g. duplicated from Default). */
  template?: string;
  readOnly: boolean;
  onDuplicate: () => void;
  onBack: () => void;
}

const PromptEditor: React.FC<PromptEditorProps> = ({
  prompt,
  template,
  readOnly,
  onDuplicate,
  onBack,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [name, setName] = useState(prompt?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(
    readOnly ? DEFAULT_TRANSLATION_PROMPT : (prompt?.systemPrompt ?? template ?? ''),
  );
  const canSave = !readOnly && !!name.trim() && !!systemPrompt.trim();

  const handleSave = () => {
    const store = useCustomTranslatorStore.getState();
    const input = { name: name.trim(), systemPrompt };
    if (prompt) store.updatePrompt(prompt.id, input);
    else store.addPrompt(input);
    void store.saveCustomTranslators(envConfig);
    onBack();
  };

  const handleDelete = () => {
    if (!prompt) return;
    const store = useCustomTranslatorStore.getState();
    store.removePrompt(prompt.id);
    void store.saveCustomTranslators(envConfig);
    onBack();
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Custom Translators')}
        currentLabel={readOnly ? _('Default') : prompt ? prompt.name : _('Add Prompt')}
        description={_(
          'Instructions sent to AI translators with every request. Choose a prompt per book under Translation.',
        )}
        onBack={onBack}
      />
      <BoxedList>
        {!readOnly && (
          <div className='flex flex-col gap-2 py-3 pe-4'>
            <SettingLabel as='label' htmlFor='tp-name'>
              {_('Name')}
            </SettingLabel>
            <input
              id='tp-name'
              type='text'
              className='input input-sm eink-bordered w-full'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={_('Literary')}
            />
          </div>
        )}
        <div className='flex flex-col gap-2 py-3 pe-4'>
          <SettingLabel as='label' htmlFor='tp-prompt'>
            {_('Prompt')}
          </SettingLabel>
          <textarea
            id='tp-prompt'
            className='textarea eink-bordered h-48 w-full text-base sm:text-sm'
            value={systemPrompt}
            readOnly={readOnly}
            spellCheck='false'
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>
      </BoxedList>
      <Tips>
        <li>
          {_('Placeholders: {{placeholders}}', {
            placeholders: '{{sourceLang}} {{targetLang}} {{bookTitle}} {{bookAuthor}}',
          })}
        </li>
        <li>{_('Output formatting rules are added automatically.')}</li>
      </Tips>
      <div className='flex justify-end gap-2 px-4'>
        {readOnly ? (
          <button type='button' className='btn btn-contrast btn-sm' onClick={onDuplicate}>
            {_('Duplicate')}
          </button>
        ) : (
          <>
            {prompt && (
              <button
                type='button'
                className='btn btn-ghost btn-sm text-error me-auto'
                onClick={handleDelete}
              >
                {_('Delete')}
              </button>
            )}
            <button
              type='button'
              className='btn btn-ghost btn-sm eink-bordered'
              onClick={() => setSystemPrompt(DEFAULT_TRANSLATION_PROMPT)}
            >
              {_('Reset to Default')}
            </button>
            <button
              type='button'
              className='btn btn-contrast btn-sm'
              onClick={handleSave}
              disabled={!canSave}
            >
              {_('Save')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

interface CustomTranslatorsProps {
  targetLang: string;
  onBack: () => void;
}

const CustomTranslators: React.FC<CustomTranslatorsProps> = ({ targetLang, onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [page, setPage] = useState<Page>({ kind: 'list' });
  const translators = useCustomTranslatorStore((s) => s.translators).filter((t) => !t.deletedAt);
  const prompts = useCustomTranslatorStore((s) => s.prompts).filter((p) => !p.deletedAt);
  const backToList = () => setPage({ kind: 'list' });

  useEffect(() => {
    ensureCustomTranslatorsLoaded(envConfig);
  }, [envConfig]);

  // Esc / Android Back steps out of an editor before leaving this sub-page.
  useKeyDownActions({ enabled: page.kind !== 'list', onCancel: backToList });

  if (page.kind === 'translator') {
    return (
      <CustomTranslatorEditor
        key={page.id ?? 'new'}
        translator={translators.find((t) => t.id === page.id)}
        targetLang={targetLang}
        onBack={backToList}
      />
    );
  }

  if (page.kind === 'prompt') {
    return (
      <PromptEditor
        key={`${page.id ?? 'new'}:${page.template ? 'dup' : ''}`}
        prompt={prompts.find((p) => p.id === page.id)}
        template={page.template}
        readOnly={page.id === DEFAULT_PROMPT_ID}
        onDuplicate={() => setPage({ kind: 'prompt', template: DEFAULT_TRANSLATION_PROMPT })}
        onBack={backToList}
      />
    );
  }

  return (
    <div className='my-4 w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('Language')}
        currentLabel={_('Custom Translators')}
        description={_(
          'Add translation services with your own API key, and prompts that tell AI translators how to translate.',
        )}
        onBack={onBack}
      />

      <div className='space-y-2'>
        {translators.length > 0 && (
          <BoxedList title={_('Translators')} cardClassName='overflow-hidden'>
            {translators.map((t) => (
              <NavigationRow
                key={t.id}
                title={t.name}
                status={[t.type === 'deepl' ? 'DeepL' : t.model, t.disabled ? _('Disabled') : '']
                  .filter(Boolean)
                  .join(' · ')}
                onClick={() => setPage({ kind: 'translator', id: t.id })}
              />
            ))}
          </BoxedList>
        )}
        <div className='grid grid-cols-1'>
          <AddButton label={_('Add Translator')} onClick={() => setPage({ kind: 'translator' })} />
        </div>
      </div>

      <div className='space-y-2'>
        <BoxedList title={_('Prompts')} cardClassName='overflow-hidden'>
          <NavigationRow
            title={_('Default')}
            status={_('Built-in')}
            onClick={() => setPage({ kind: 'prompt', id: DEFAULT_PROMPT_ID })}
          />
          {prompts.map((p) => (
            <NavigationRow
              key={p.id}
              title={p.name}
              onClick={() => setPage({ kind: 'prompt', id: p.id })}
            />
          ))}
        </BoxedList>
        <div className='grid grid-cols-1'>
          <AddButton label={_('Add Prompt')} onClick={() => setPage({ kind: 'prompt' })} />
        </div>
      </div>
    </div>
  );
};

export default CustomTranslators;
