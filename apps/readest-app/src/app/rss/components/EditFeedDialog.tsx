'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { RSSCatalog } from '@/types/rss';
import { FiX, FiSave } from 'react-icons/fi';

interface EditFeedDialogProps {
  feed: RSSCatalog;
  onSave: (feed: RSSCatalog) => void;
  onClose: () => void;
}

export function EditFeedDialog({ feed, onSave, onClose }: EditFeedDialogProps) {
  const _ = useTranslation();
  const [name, setName] = useState(feed.name);
  const [url, setUrl] = useState(feed.url);
  const [folder, setFolder] = useState(feed.folder || '');
  const [tags, setTags] = useState((feed.tags || []).join(', '));
  const [description, setDescription] = useState(feed.description || '');

  const handleSave = () => {
    if (!name.trim()) return;

    const updatedFeed: RSSCatalog = {
      ...feed,
      name: name.trim(),
      url: url.trim(),
      folder: folder.trim() || undefined,
      tags: tags.split(',').map(t => t.trim()).filter(t => t.length > 0),
      description: description.trim() || undefined,
    };

    onSave(updatedFeed);
  };

  return (
    <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/50'>
      <div className='bg-base-100 max-w-lg rounded-lg p-6 shadow-xl'>
        <div className='mb-4 flex items-center justify-between'>
          <h2 className='text-xl font-bold'>{_('Edit RSS Feed')}</h2>
          <button className='btn btn-ghost btn-sm' onClick={onClose}>
            <FiX size={20} />
          </button>
        </div>

        <div className='space-y-4'>
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
        </div>

        <div className='mt-6 flex justify-end gap-2'>
          <button className='btn btn-ghost' onClick={onClose}>
            {_('Cancel')}
          </button>
          <button className='btn btn-primary' onClick={handleSave}>
            <FiSave className='mr-2 h-4 w-4' />
            {_('Save Changes')}
          </button>
        </div>
      </div>
    </div>
  );
}
