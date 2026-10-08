import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import {
  LuArrowDown,
  LuArrowUp,
  LuClipboardPaste,
  LuImagePlus,
  LuPlus,
  LuTrash2,
  LuX,
} from 'react-icons/lu';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { BookCharacter, CharacterBlock, CharacterBlockType, CharacterTag } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { getCharacterTags, upsertCharacterTag } from '@/store/characterTagsStore';

const MAX_IMAGE_SIZE = 800;
const MAX_AVATAR_SIZE = 256;

/** Downscale to keep the book config small; flatten transparency onto white. */
async function imageToDataUrl(file: Blob, maxSize: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

const imagesFrom = (files: FileList | File[] | undefined | null): File[] =>
  Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));

// Fixed swatches so character dots stay visually distinct from one another.
export const CHARACTER_COLOR_SWATCHES = [
  '#f97316', // orange (default)
  '#ef4444', // red
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
];

interface CharacterDialogProps {
  character: BookCharacter;
  isNew: boolean;
  onSave: (character: BookCharacter) => void;
  onDelete: (character: BookCharacter) => void;
  onClose: () => void;
}

const CharacterDialog: React.FC<CharacterDialogProps> = ({
  character,
  isNew,
  onSave,
  onDelete,
  onClose,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [name, setName] = useState(character.name);
  const [aliases, setAliases] = useState((character.aliases ?? []).join(', '));
  const [color, setColor] = useState(character.color ?? CHARACTER_COLOR_SWATCHES[0]!);
  const [avatarSrc, setAvatarSrc] = useState(character.avatarSrc ?? '');
  const [blocks, setBlocks] = useState<CharacterBlock[]>(character.blocks);
  const [tagIds, setTagIds] = useState<string[]>(character.tagIds ?? []);
  const [allTags, setAllTags] = useState<CharacterTag[]>(() => getCharacterTags());
  const [newTagName, setNewTagName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Which image slot the file picker was opened for (null = append a new one).
  const pickerTarget = useRef<string | null>(null);

  const updateBlock = (id: string, patch: Partial<CharacterBlock>) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const addBlock = (type: CharacterBlockType) =>
    setBlocks((prev) => [...prev, { id: uniqueId(), type, text: '', heading: '', src: '' }]);

  const moveBlock = (id: string, delta: -1 | 1) =>
    setBlocks((prev) => {
      const i = prev.findIndex((b) => b.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id));

  // Put images into `targetId` (first one) and append the rest; with no target,
  // fill the first empty image slot before appending.
  const insertImages = async (files: File[], targetId?: string | null) => {
    if (!files.length) return;
    const urls: string[] = [];
    for (const file of files) {
      try {
        urls.push(await imageToDataUrl(file, MAX_IMAGE_SIZE));
      } catch (err) {
        console.warn('Failed to read image', err);
      }
    }
    if (!urls.length) return;
    setBlocks((prev) => {
      const next = prev.map((b) => ({ ...b }));
      let target = targetId;
      for (const src of urls) {
        const slot = target
          ? next.find((b) => b.id === target && b.type === 'image')
          : next.find((b) => b.type === 'image' && !b.src);
        target = null;
        if (slot) slot.src = src;
        else next.push({ id: uniqueId(), type: 'image', src });
      }
      return next;
    });
  };

  const insertAvatar = async (files: File[]) => {
    const [file] = imagesFrom(files);
    if (!file) return;
    try {
      setAvatarSrc(await imageToDataUrl(file, MAX_AVATAR_SIZE));
    } catch (err) {
      console.warn('Failed to read avatar image', err);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = imagesFrom(e.clipboardData.files);
    if (!files.length) return; // plain text paste keeps its default behavior
    e.preventDefault();
    void insertImages(files);
  };

  const readClipboardImages = async (): Promise<File[]> => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) files.push(new File([await item.getType(type)], 'pasted', { type }));
      }
      return files;
    } catch (err) {
      console.warn('Clipboard image read failed', err);
      return [];
    }
  };

  const handlePasteButton = async (targetId?: string) =>
    insertImages(await readClipboardImages(), targetId);
  const handlePasteAvatarButton = async () => insertAvatar(await readClipboardImages());

  const openPicker = (targetId: string | null) => {
    pickerTarget.current = targetId;
    fileInputRef.current?.click();
  };

  const toggleTag = (tagId: string) =>
    setTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
    );

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    const tag = await upsertCharacterTag(envConfig, { name });
    setAllTags((prev) => [...prev, tag]);
    setTagIds((prev) => [...prev, tag.id]);
    setNewTagName('');
  };

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({
      ...character,
      name: trimmed,
      aliases: aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      color,
      avatarSrc: avatarSrc || undefined,
      tagIds,
      // Drop slots the user never filled.
      blocks: blocks.filter((b) => (b.type === 'image' ? !!b.src : !!b.text?.trim())),
    });
  };

  const iconBtn = 'btn btn-ghost btn-xs btn-square';

  return (
    <Dialog
      id='character-dialog'
      isOpen
      title={isNew ? _('New Character') : _('Character')}
      onClose={onClose}
      boxClassName='sm:h-[85%] sm:min-w-[520px] sm:max-w-[640px]'
      contentClassName='px-4! sm:px-6!'
      useOverlayScroll
    >
      <div className='flex flex-col gap-4 pb-6 pt-2' onPaste={handlePaste}>
        <div className='flex items-center gap-4'>
          <div
            className='group relative shrink-0 cursor-pointer'
            onClick={() => avatarInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void insertAvatar(imagesFrom(e.dataTransfer.files));
            }}
          >
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarSrc}
                alt={name}
                className='border-base-300 h-16 w-16 rounded-full border object-cover'
              />
            ) : (
              <div className='bg-base-200 text-base-content/50 flex h-16 w-16 items-center justify-center rounded-full border border-dashed text-xs'>
                {_('Photo')}
              </div>
            )}
            {avatarSrc && (
              <button
                className='btn btn-circle btn-xs absolute -right-1 -top-1'
                onClick={(e) => {
                  e.stopPropagation();
                  setAvatarSrc('');
                }}
              >
                <LuX size={12} />
              </button>
            )}
          </div>
          <div className='flex flex-col gap-2'>
            <div className='flex gap-2'>
              <button className='btn btn-xs' onClick={() => avatarInputRef.current?.click()}>
                <LuImagePlus /> {_('Upload')}
              </button>
              <button className='btn btn-xs' onClick={handlePasteAvatarButton}>
                <LuClipboardPaste /> {_('Paste')}
              </button>
            </div>
            <div className='flex items-center gap-1.5'>
              {CHARACTER_COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  aria-label={swatch}
                  onClick={() => setColor(swatch)}
                  className={clsx(
                    'h-5 w-5 rounded-full border-2',
                    color === swatch ? 'border-base-content' : 'border-transparent',
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>
        </div>

        <label className='form-control w-full'>
          <span className='label-text mb-1'>{_('Name')}</span>
          <input
            className='input input-bordered w-full'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className='form-control w-full'>
          <span className='label-text mb-1'>{_('Other names (comma separated)')}</span>
          <input
            className='input input-bordered w-full'
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </label>

        <div className='flex flex-col gap-1.5'>
          <span className='label-text'>{_('Tags')}</span>
          <div className='flex flex-wrap items-center gap-1.5'>
            {allTags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={clsx(
                  'badge cursor-pointer',
                  tagIds.includes(tag.id) ? 'badge-primary' : 'badge-outline',
                )}
              >
                {tag.name}
              </button>
            ))}
            <input
              className='input input-bordered input-xs w-28'
              placeholder={_('New tag')}
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateTag();
                }
              }}
            />
            <button className={iconBtn} onClick={handleCreateTag}>
              <LuPlus />
            </button>
          </div>
        </div>

        {blocks.map((block, i) => (
          <div key={block.id} className='border-base-300 rounded-lg border p-3'>
            {block.type === 'image' && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const files = imagesFrom(e.dataTransfer.files);
                  if (!files.length) return;
                  e.preventDefault();
                  void insertImages(files, block.id);
                }}
              >
                {block.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={block.src} alt={name} className='mx-auto max-h-72 rounded' />
                ) : (
                  <div className='text-base-content/60 flex flex-col items-center gap-2 py-6 text-sm'>
                    <span>{_('Paste (Ctrl+V), drop or upload an image')}</span>
                    <div className='flex gap-2'>
                      <button className='btn btn-sm' onClick={() => openPicker(block.id)}>
                        <LuImagePlus /> {_('Upload')}
                      </button>
                      <button className='btn btn-sm' onClick={() => handlePasteButton(block.id)}>
                        <LuClipboardPaste /> {_('Paste')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {block.type === 'text' && (
              <div className='flex flex-col gap-1.5'>
                <input
                  className='input input-bordered input-sm w-full font-semibold'
                  placeholder={_('Heading (optional)')}
                  value={block.heading ?? ''}
                  onChange={(e) => updateBlock(block.id, { heading: e.target.value })}
                />
                <textarea
                  className='textarea textarea-bordered min-h-24 w-full'
                  placeholder={_('Description')}
                  value={block.text ?? ''}
                  onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                />
              </div>
            )}
            {block.type === 'quote' && (
              <div className='flex flex-col gap-1.5'>
                <span className='text-base-content/60 text-xs uppercase tracking-wide'>
                  {_('Quote')}
                </span>
                <textarea
                  className='textarea textarea-bordered italic min-h-16 w-full'
                  placeholder={_('What the character says...')}
                  value={block.text ?? ''}
                  onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                />
              </div>
            )}
            <div className='mt-2 flex justify-end gap-1'>
              {block.type === 'image' && block.src && (
                <button className={iconBtn} onClick={() => openPicker(block.id)}>
                  <LuImagePlus />
                </button>
              )}
              <button
                className={iconBtn}
                disabled={i === 0}
                onClick={() => moveBlock(block.id, -1)}
              >
                <LuArrowUp />
              </button>
              <button
                className={iconBtn}
                disabled={i === blocks.length - 1}
                onClick={() => moveBlock(block.id, 1)}
              >
                <LuArrowDown />
              </button>
              <button className={clsx(iconBtn, 'text-error')} onClick={() => removeBlock(block.id)}>
                <LuTrash2 />
              </button>
            </div>
          </div>
        ))}

        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-base-content/60 text-sm'>{_('Add')}:</span>
          <button className='btn btn-sm' onClick={() => addBlock('image')}>
            {_('Image')}
          </button>
          <button className='btn btn-sm' onClick={() => addBlock('text')}>
            {_('Text')}
          </button>
        </div>

        <div className='mt-2 flex justify-between'>
          {isNew ? (
            <span />
          ) : (
            <button className='btn btn-ghost text-error' onClick={() => onDelete(character)}>
              {_('Delete')}
            </button>
          )}
          <div className='flex gap-2'>
            <button className='btn btn-ghost' onClick={onClose}>
              {_('Cancel')}
            </button>
            <button className='btn btn-primary' disabled={!name.trim()} onClick={handleSave}>
              {_('Save')}
            </button>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        multiple
        className='hidden'
        onChange={(e) => {
          void insertImages(imagesFrom(e.target.files), pickerTarget.current);
          e.target.value = '';
        }}
      />
      <input
        ref={avatarInputRef}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={(e) => {
          void insertAvatar(imagesFrom(e.target.files));
          e.target.value = '';
        }}
      />
    </Dialog>
  );
};

export default CharacterDialog;
