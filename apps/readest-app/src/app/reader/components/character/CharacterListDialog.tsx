import React, { useMemo } from 'react';
import { LuUserPlus } from 'react-icons/lu';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { BookCharacter, CharacterTag } from '@/types/book';
import { CHARACTER_COLOR_SWATCHES } from './CharacterDialog';

interface CharacterListDialogProps {
  characters: BookCharacter[];
  tags: CharacterTag[];
  onSelect: (character: BookCharacter) => void;
  onCreate: () => void;
  onClose: () => void;
}

const CharacterListDialog: React.FC<CharacterListDialogProps> = ({
  characters,
  tags,
  onSelect,
  onCreate,
  onClose,
}) => {
  const _ = useTranslation();
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const sorted = useMemo(
    () => [...characters].sort((a, b) => a.name.localeCompare(b.name)),
    [characters],
  );

  return (
    <Dialog
      id='character-list-dialog'
      isOpen
      title={_('Characters')}
      onClose={onClose}
      boxClassName='sm:h-[80%] sm:min-w-[480px] sm:max-w-[600px]'
      contentClassName='px-4! sm:px-6!'
      useOverlayScroll
    >
      <div className='flex flex-col gap-3 pb-6 pt-2'>
        <button className='btn btn-sm btn-primary self-start' onClick={onCreate}>
          <LuUserPlus /> {_('New Character')}
        </button>

        {sorted.length === 0 && (
          <p className='text-base-content/60 py-8 text-center text-sm'>
            {_('No characters yet. Select a name in the text to add one.')}
          </p>
        )}

        {sorted.map((character) => (
          <button
            key={character.id}
            onClick={() => onSelect(character)}
            className='border-base-300 hover:bg-base-200 flex items-center gap-3 rounded-lg border p-3 text-left'
          >
            {character.avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={character.avatarSrc}
                alt={character.name}
                className='h-10 w-10 shrink-0 rounded-full object-cover'
              />
            ) : (
              <span
                className='h-3 w-3 shrink-0 rounded-full'
                style={{ backgroundColor: character.color ?? CHARACTER_COLOR_SWATCHES[0] }}
              />
            )}
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <span className='truncate font-medium'>{character.name}</span>
              {!!character.tagIds?.length && (
                <div className='flex flex-wrap gap-1'>
                  {character.tagIds.map((tagId) => {
                    const tag = tagById.get(tagId);
                    if (!tag) return null;
                    return (
                      <span key={tagId} className='badge badge-outline badge-sm'>
                        {tag.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </Dialog>
  );
};

export default CharacterListDialog;
