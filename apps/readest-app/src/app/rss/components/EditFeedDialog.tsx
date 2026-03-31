'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { RSSCatalog } from '@/types/rss';
import { FiX, FiSave } from 'react-icons/fi';

interface EditFeedDialogProps {
  feed: RSSCatalog;
  onSave: (feed: RSSCatalog) => void;
  onClose: () => void;
}

const PRESET_COLORS = [
  '', // No color (default)
  '#ef4444', // Red
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#6b7280', // Gray
  '#78350f', // Brown
];

export function EditFeedDialog({ feed, onSave, onClose }: EditFeedDialogProps) {
  const _ = useTranslation();
  const [name, setName] = useState(feed.name);
  const [url, setUrl] = useState(feed.url);
  const [folder, setFolder] = useState(feed.folder || '');
  const [tags, setTags] = useState((feed.tags || []).join(', '));
  const [description, setDescription] = useState(feed.description || '');
  const [priority, setPriority] = useState(feed.priority || false);
  const [color, setColor] = useState(feed.color || '');
  const [showCustomColor, setShowCustomColor] = useState(false);
  const [customColor, setCustomColor] = useState(feed.color || '');

  const handleSave = () => {
    if (!name.trim()) return;

    const updatedFeed: RSSCatalog = {
      ...feed,
      name: name.trim(),
      url: url.trim(),
      folder: folder.trim() || undefined,
      tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
      description: description.trim() || undefined,
      priority,
      color: color || undefined,
    };

    onSave(updatedFeed);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-base-100 flex h-auto max-h-[90vh] w-full max-w-lg flex-col rounded-lg p-6 shadow-xl">
        <div className="mb-4 flex flex-shrink-0 items-center justify-between">
          <h2 className="text-xl font-bold">{_('Edit RSS Feed')}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <FiX size={20} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto">
          <div>
            <label className='label'>
              <span className='label-text'>{_('Feed Name')}</span>
            </label>
            <input
              type='text'
              className='input input-bordered w-full'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={_('My RSS Feed')}
            />
          </div>

          <div>
            <label className='label'>
              <span className='label-text'>{_('Feed URL')}</span>
            </label>
            <input
              type='url'
              className='input input-bordered w-full'
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder='https://example.com/feed.xml'
            />
          </div>

          <div>
            <label className='label'>
              <span className='label-text'>{_('Folder')}</span>
              <span className='label-text-alt'>{_('Optional')}</span>
            </label>
            <input
              type='text'
              className='input input-bordered w-full'
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder={_('e.g., Technology, News, Science')}
            />
          </div>

          <div>
            <label className='label'>
              <span className='label-text'>{_('Tags')}</span>
              <span className='label-text-alt'>{_('Optional')}</span>
            </label>
            <input
              type='text'
              className='input input-bordered w-full'
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={_('ai, research, daily')}
            />
            <p className='text-base-content/50 mt-1 text-xs'>{_('Separate tags with commas')}</p>
          </div>

          <div>
            <label className='label'>
              <span className='label-text'>{_('Description')}</span>
              <span className='label-text-alt'>{_('Optional')}</span>
            </label>
            <textarea
              className='textarea textarea-bordered w-full'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={_('Describe this feed...')}
              rows={3}
            />
          </div>

          <div>
            <label className='label'>
              <span className='label-text'>{_('Feed Color')}</span>
              <span className='label-text-alt'>{_('Optional')}</span>
            </label>
            <div className='flex flex-wrap gap-2'>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c || 'default'}
                  className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c ? 'border-base-content' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c || 'transparent' }}
                  onClick={() => {
                    setColor(c);
                    setShowCustomColor(false);
                  }}
                  title={c || _('Default')}
                >
                  {!c && (
                    <span className='flex h-full w-full items-center justify-center text-xs text-base-content/50'>
                      ∅
                    </span>
                  )}
                </button>
              ))}
              <button
                className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                  showCustomColor ? 'border-base-content' : 'border-transparent'
                }`}
                style={{ background: 'linear-gradient(135deg, #ef4444 25%, #3b82f6 25%, #3b82f6 50%, #22c55e 50%, #22c55e 75%, #eab308 75%)' }}
                onClick={() => setShowCustomColor(!showCustomColor)}
                title={_('Custom color')}
              >
                <span className='flex h-full w-full items-center justify-center text-xs text-white drop-shadow'>
                  +
                </span>
              </button>
            </div>
            {showCustomColor && (
              <div className='mt-2 flex items-center gap-2'>
                <input
                  type='color'
                  className='h-8 w-12 cursor-pointer rounded border border-base-300'
                  value={customColor || '#3b82f6'}
                  onChange={(e) => {
                    setCustomColor(e.target.value);
                    setColor(e.target.value);
                  }}
                />
                <span className='text-sm text-base-content/70'>{customColor || _('Select color')}</span>
              </div>
            )}
            {color && (
              <div className='mt-2 flex items-center gap-2'>
                <div
                  className='h-4 w-4 rounded'
                  style={{ backgroundColor: color }}
                />
                <span className='text-sm text-base-content/70'>{color}</span>
                <button
                  className='btn btn-ghost btn-xs'
                  onClick={() => {
                    setColor('');
                    setShowCustomColor(false);
                  }}
                >
                  {_('Clear')}
                </button>
              </div>
            )}
          </div>

          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                className="checkbox checkbox-primary"
                checked={priority}
                onChange={(e) => setPriority(e.target.checked)}
              />
              <div>
                <span className="label-text font-semibold">{_('Priority Feed')}</span>
                <p className="text-base-content/50 label-text-alt text-xs">
                  {_('Show at the top of All Feeds view')}
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-shrink-0 justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>
            {_('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            <FiSave className="mr-2 h-4 w-4" />
            {_('Save Changes')}
          </button>
        </div>
      </div>
    </div>
  );
}
