import clsx from 'clsx';
import React, { useState } from 'react';
import { MdCheck, MdPlayArrow, MdStop } from 'react-icons/md';
import { PiSpinner } from 'react-icons/pi';
import { BoxedList, SettingLabel } from '@/components/settings/primitives';
import { useTranslation } from '@/hooks/useTranslation';
import type { VoicePreviewStatus } from '@/hooks/useVoicePreview';
import type { TTSVoice, TTSVoicesGroup } from '@/services/tts/types';
import { canPreviewEngine } from '@/services/tts/voicePreview';
import { getLanguageName } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

type GenderFilter = 'all' | 'female' | 'male';

// "English (United States)" in the reader's UI language.
export const getVoiceLanguageName = (lang: string): string => {
  try {
    const names = new Intl.DisplayNames([getLocale()], {
      type: 'language',
      languageDisplay: 'standard',
    });
    return names.of(lang) ?? lang;
  } catch {
    return getLanguageName(lang);
  }
};

interface VoiceListProps {
  groups: TTSVoicesGroup[];
  // The voice in use (reader) or the language's default (Settings); a missing
  // engine matches the id in any group.
  selected: { engine?: string; voiceId: string } | null;
  onSelect: (group: TTSVoicesGroup, voice: TTSVoice) => void;
  // A voice the reader's plan lacks: tapping it leads here instead.
  onUpgrade: () => void;
  preview: {
    toggle: (group: TTSVoicesGroup, voice: TTSVoice) => void;
    statusOf: (group: TTSVoicesGroup, voice: TTSVoice) => VoicePreviewStatus | null;
  };
}

// Voices by engine, one boxed list each, filterable by gender. A row's round
// button previews the voice; the rest of the row picks it.
const VoiceList: React.FC<VoiceListProps> = ({
  groups,
  selected,
  onSelect,
  onUpgrade,
  preview,
}) => {
  const _ = useTranslation();
  const [gender, setGender] = useState<GenderFilter>('all');
  // A name a user's own service gave is shown as is; built-in names are UI strings.
  const nameOf = (item: TTSVoice | TTSVoicesGroup) => (item.literalName ? item.name : _(item.name));
  const hasGenders = groups.some((group) => group.voices.some((voice) => voice.gender));
  const shown = groups
    .map((group) => ({
      group,
      voices: group.voices.filter((voice) => gender === 'all' || voice.gender === gender),
    }))
    .filter(({ voices }) => voices.length > 0);

  const genderLabel = (value: TTSVoice['gender'] | GenderFilter) =>
    value === 'female' ? _('Female') : value === 'male' ? _('Male') : _('All');

  return (
    <div className='flex w-full flex-col gap-4'>
      {hasGenders && (
        <div
          role='radiogroup'
          aria-label={_('Gender')}
          className='bg-base-200 eink-bordered inline-flex items-center self-start rounded-full p-0.5'
        >
          {(['all', 'female', 'male'] as const).map((value) => (
            <button
              key={value}
              type='button'
              role='radio'
              aria-checked={gender === value}
              onClick={() => setGender(value)}
              className={clsx(
                'flex h-9 items-center justify-center rounded-full px-4 text-[0.85em] font-medium transition-colors',
                'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
                gender === value
                  ? 'bg-base-300 text-base-content eink-inverted shadow-xs'
                  : 'text-base-content/60 hover:text-base-content',
              )}
            >
              {genderLabel(value)}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 && (
        <p className='text-base-content/70 px-4 py-6 text-center'>
          {gender === 'all' ? _('No voices available') : _('No voices match this filter')}
        </p>
      )}
      {shown.map(({ group, voices }) => (
        <BoxedList key={group.id} title={nameOf(group)}>
          {voices.map((voice) => {
            const isSelected =
              !!selected &&
              selected.voiceId === voice.id &&
              (!selected.engine || selected.engine === group.engine);
            // A voice the plan lacks stays tappable: it leads to the upgrade.
            const locked = !!voice.disabled && !!voice.tier;
            const status = preview.statusOf(group, voice);
            const canPreview = canPreviewEngine(group.engine) && (!voice.disabled || locked);
            return (
              <div key={voice.id} className='flex min-h-14 items-center gap-3 pe-4'>
                {canPreview && (
                  <button
                    type='button'
                    aria-label={
                      status ? _('Stop Preview') : _('Preview {{voice}}', { voice: nameOf(voice) })
                    }
                    title={status ? _('Stop Preview') : _('Preview')}
                    aria-pressed={!!status}
                    onClick={() => preview.toggle(group, voice)}
                    className={clsx(
                      'eink-bordered flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-150',
                      'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
                      status
                        ? 'bg-base-content text-base-100 eink-inverted'
                        : 'not-eink:bg-base-200 hover:bg-base-300',
                    )}
                  >
                    {status === 'loading' ? (
                      <PiSpinner className='h-5 w-5 animate-spin' />
                    ) : status === 'playing' ? (
                      <MdStop className='h-5 w-5' />
                    ) : (
                      <MdPlayArrow className='h-5 w-5' />
                    )}
                  </button>
                )}
                <button
                  type='button'
                  disabled={voice.disabled && !locked}
                  aria-current={isSelected || undefined}
                  onClick={() => (locked ? onUpgrade() : onSelect(group, voice))}
                  className='flex min-w-0 flex-1 items-center gap-2 self-stretch py-2 text-start disabled:cursor-not-allowed'
                >
                  <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <span className='flex min-w-0 items-center gap-1.5'>
                      <SettingLabel
                        className={clsx(
                          'line-clamp-1! min-w-0',
                          voice.disabled && 'text-base-content/60',
                        )}
                      >
                        {nameOf(voice)}
                      </SettingLabel>
                      {voice.gender && (
                        <span className='badge badge-sm badge-ghost shrink-0'>
                          {genderLabel(voice.gender)}
                        </span>
                      )}
                    </span>
                    <span className='text-base-content/65 truncate text-[0.85em]'>
                      {[
                        getVoiceLanguageName(voice.lang),
                        voice.variant === 'multilingual' && _('Multilingual'),
                        voice.variant === 'expressive' && _('Expressive'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {voice.tier && (
                    <span className='badge badge-sm badge-ghost shrink-0'>
                      {voice.tier === 'pro' ? _('Pro') : _('Plus')}
                    </span>
                  )}
                  <span className='flex w-5 shrink-0 justify-center'>
                    {isSelected && <MdCheck className='h-5 w-5' aria-hidden='true' />}
                  </span>
                </button>
              </div>
            );
          })}
        </BoxedList>
      ))}
    </div>
  );
};

export default VoiceList;
