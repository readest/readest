'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { RSSCatalog, ACADEMIC_FEEDS } from '@/types/rss';
import { useSettingsStore } from '@/store/settingsStore';
import { FiUpload, FiTrash2, FiEdit3, FiChevronLeft, FiChevronRight, FiRss } from 'react-icons/fi';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import { saveSysSettings } from '@/helpers/settings';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { isTauriAppPlatform } from '@/services/environment';
import { EditFeedDialog } from './EditFeedDialog';

interface RSSManagerProps {
  onFeedSelect: (feed: RSSCatalog) => void;
  onClose: () => void;
}

export function RSSManager({ onFeedSelect, onClose }: RSSManagerProps) {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const [customURL, setCustomURL] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingFeed, setEditingFeed] = useState<RSSCatalog | null>(null);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const userFeeds = settings.rssFeeds || [];
  const allFeeds = [...ACADEMIC_FEEDS];
  
  // Merge user feeds, avoiding duplicates with predefined feeds
  userFeeds.forEach((userFeed) => {
    const exists = allFeeds.some((f) => f.id === userFeed.id);
    if (!exists) {
      allFeeds.push(userFeed);
    }
  });

  // Listen for file drops from dialog
  useEffect(() => {
    const handleFileDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{ file: File }>;
      const file = customEvent.detail.file;
      console.log('[RSS Manager] Received dropped file:', file.name);
      
      // Simulate file input change
      const fakeEvent = {
        target: {
          files: [file],
          value: '',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      
      handleImportRSSFile(fakeEvent);
    };

    window.addEventListener('rss-file-drop', handleFileDrop as EventListener);
    return () => window.removeEventListener('rss-file-drop', handleFileDrop as EventListener);
  }, [userFeeds]);

  const handleBrowseFiles = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'RSS/OPML Files',
          extensions: ['opml', 'rss', 'xml'],
        }],
      });

      if (selected && typeof selected === 'string') {
        console.log('[RSS Manager] Selected file:', selected);
        const fileContent = await readTextFile(selected);
        const fileName = selected.split('/').pop()?.split('\\').pop() || 'imported-feed';
        
        // Create a fake File object
        const file = new File([fileContent], fileName, { type: 'text/xml' });
        const fakeEvent = {
          target: {
            files: [file],
            value: '',
          },
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        
        handleImportRSSFile(fakeEvent);
      }
    } catch (e) {
      console.error('Failed to open file picker:', e);
      setError(_('Failed to open file picker'));
    }
  };

  const handleEditFeed = (feed: RSSCatalog) => {
    setEditingFeed(feed);
  };

  const handleSaveFeed = async (updatedFeed: RSSCatalog) => {
    const updatedFeeds = userFeeds.map((f) => 
      f.id === updatedFeed.id ? updatedFeed : f
    );
    await saveFeeds(updatedFeeds);
    setEditingFeed(null);
    eventDispatcher.dispatch('toast', {
      message: _('Feed updated successfully'),
      timeout: 3000,
      type: 'success',
    });
  };

  // Get unique folders for filter dropdown
  const folders = [...new Set(userFeeds.map((f) => f.folder).filter(Boolean))];

  const saveFeeds = async (updatedFeeds: RSSCatalog[]) => {
    try {
      await saveSysSettings(envConfig, 'rssFeeds', updatedFeeds);
    } catch (e) {
      console.error('[RSS Manager] Failed to save feeds:', e);
    }
  };

  const handleToggleFeed = async (feed: RSSCatalog) => {
    const isPredefined = ACADEMIC_FEEDS.some((f) => f.id === feed.id);
    
    if (isPredefined) {
      // For predefined feeds, just toggle in userFeeds list
      const exists = userFeeds.some((f) => f.id === feed.id);
      const updatedFeeds = exists
        ? userFeeds.filter((f) => f.id !== feed.id)
        : [...userFeeds, feed];
      
      await saveFeeds(updatedFeeds);
    } else {
      // For custom feeds, remove them (toggle off = delete)
      const updatedFeeds = userFeeds.filter((f) => f.id !== feed.id);
      await saveFeeds(updatedFeeds);
    }
  };

  const handleAddCustomFeed = async () => {
    if (!customURL.trim()) return;

    try {
      // For live feeds, just store the URL
      const newFeed: RSSCatalog = {
        id: `custom-${Date.now()}`,
        name: _('Custom Feed'),
        url: customURL.trim(),
        description: _('Custom RSS feed'),
        icon: '📰',
        category: 'Custom',
      };

      await saveFeeds([...userFeeds, newFeed]);
      setCustomURL('');
      setError(null);
    } catch (e) {
      setError(_('Failed to add feed'));
    }
  };

  const handleImportRSSFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !appService) return;

    try {
      // Read the file content
      const fileContent = await file.text();
      
      // Check if it's an OPML file
      if (fileContent.includes('<opml')) {
        await handleImportOPML(fileContent);
      } else if (fileContent.includes('<rss') || fileContent.includes('<feed')) {
        // It's a regular RSS feed file
        if (!fileContent.includes('<rss') && !fileContent.includes('<feed')) {
          setError(_('File does not appear to be a valid RSS feed'));
          return;
        }

        // For local files, store the content directly in the feed config
        const fileName = file.name.replace(/\.(rss|xml)$/, '');
        const newFeed: RSSCatalog = {
          id: `local-${Date.now()}`,
          name: fileName || _('Local RSS Feed'),
          url: '', // Empty URL for local files
          description: _('Imported from file'),
          icon: '📁',
          category: 'Local',
          isLocal: true,
          fileContent: fileContent, // Store the actual XML content
        };

        await saveFeeds([...userFeeds, newFeed]);

        eventDispatcher.dispatch('toast', {
          message: _('RSS feed imported successfully'),
          timeout: 3000,
          type: 'success',
        });
      } else {
        setError(_('File does not appear to be a valid RSS or OPML file'));
        return;
      }

      setError(null);
    } catch (e) {
      setError(_('Failed to import file'));
      console.error('File import error:', e);
    }

    // Reset file input
    event.target.value = '';
  };

  const handleImportOPML = async (opmlContent: string) => {
    try {
      console.log('[OPML Import] Parsing OPML content, length:', opmlContent.length);
      console.log('[OPML Import] First 200 chars:', opmlContent.substring(0, 200));
      
      // Sanitize common XML issues
      let sanitized = opmlContent
        // Fix unescaped ampersands in attribute values (but not in entities)
        .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(sanitized, 'text/xml');
      
      // Check for parse errors
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        console.error('[OPML Import] Parser error:', parseError.textContent);
        throw new Error(_('Invalid OPML file: ') + parseError.textContent);
      }

      // Find all outline elements with xmlUrl attribute (RSS feeds)
      const outlines = doc.querySelectorAll('outline[xmlUrl]');
      console.log('[OPML Import] Found', outlines.length, 'feeds');
      
      const newFeeds: RSSCatalog[] = [];

      outlines.forEach((outline) => {
        const url = outline.getAttribute('xmlUrl');
        const title = outline.getAttribute('text') || outline.getAttribute('title') || outline.getAttribute('xmlUrl') || 'Unnamed Feed';
        // Get folder from parent outline or use category
        const parentOutline = outline.parentElement?.closest('outline');
        const folder = parentOutline?.getAttribute('text') || parentOutline?.getAttribute('title') || undefined;
        const tags: string[] = [];
        
        // Extract tags from outline attributes if present
        const tagsAttr = outline.getAttribute('tags');
        if (tagsAttr) {
          tags.push(...tagsAttr.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0));
        }
        
        if (url) {
          newFeeds.push({
            id: `opml-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: title,
            url: url,
            description: _('Imported from OPML'),
            icon: '📰',
            category: 'OPML Import',
            folder,
            tags: tags.length > 0 ? tags : undefined,
          });
        }
      });

      if (newFeeds.length === 0) {
        // Try alternative OPML format - some use url instead of xmlUrl
        const altOutlines = doc.querySelectorAll('outline[url]');
        console.log('[OPML Import] Trying alternative format, found', altOutlines.length, 'feeds');
        
        altOutlines.forEach((outline) => {
          const url = outline.getAttribute('url');
          const title = outline.getAttribute('text') || outline.getAttribute('title') || 'Unnamed Feed';
          
          if (url) {
            newFeeds.push({
              id: `opml-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: title,
              url: url,
              description: _('Imported from OPML'),
              icon: '📰',
              category: 'OPML Import',
            });
          }
        });
      }

      if (newFeeds.length === 0) {
        setError(_('No RSS feeds found in OPML file'));
        return;
      }

      // Add all feeds to existing feeds
      await saveFeeds([...userFeeds, ...newFeeds]);

      // Show success with warning if some feeds might be broken
      const message = newFeeds.length > 1 
        ? _('Imported {{count}} feeds from OPML. Some feeds may be inactive.', { count: newFeeds.length })
        : _('Imported {{count}} feed from OPML', { count: newFeeds.length });
      
      eventDispatcher.dispatch('toast', {
        message,
        timeout: 5000,
        type: newFeeds.length > 0 ? 'success' : 'warning',
      });

      setError(null);
    } catch (e) {
      console.error('OPML import error:', e);
      throw new Error(_('Failed to parse OPML file: ') + (e as Error).message);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    console.log('[RSS Drop] File dropped:', e.dataTransfer.files?.[0]?.name);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    try {
      const fileContent = await file.text();

      if (fileContent.includes('<opml')) {
        await handleImportOPML(fileContent);
      } else if (fileContent.includes('<rss') || fileContent.includes('<feed')) {
        // Handle as RSS feed file
        const fileName = file.name.replace(/\.(rss|xml)$/, '');
        const newFeed: RSSCatalog = {
          id: `local-${Date.now()}`,
          name: fileName || _('Local RSS Feed'),
          url: '',
          description: _('Imported from file'),
          icon: '📁',
          category: 'Local',
          isLocal: true,
          fileContent: fileContent,
        };

        await saveFeeds([...userFeeds, newFeed]);

        eventDispatcher.dispatch('toast', {
          message: _('RSS feed imported successfully'),
          timeout: 3000,
          type: 'success',
        });
      } else {
        setError(_('File does not appear to be a valid RSS or OPML file'));
        return;
      }

      setError(null);
    } catch (e) {
      setError(_('Failed to import file'));
      console.error('File import error:', e);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    console.log('[RSS Drag] Drag over');
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    console.log('[RSS Drag] Drag leave');
  };

  const handleImportFromURL = async () => {
    if (!customURL.trim()) return;

    try {
      const url = customURL.trim();
      
      // For web platform, we might need to use a proxy for CORS
      // For now, try direct fetch first
      let response;
      try {
        response = await fetch(url, {
          mode: 'cors',
          headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          },
        });
      } catch (fetchError) {
        // If direct fetch fails (likely CORS), provide helpful error
        console.error('Direct fetch failed:', fetchError);
        throw new Error(_('Failed to fetch. This may be due to CORS restrictions. Try downloading the file and uploading it directly, or use a live feed subscription instead.'));
      }

      if (!response.ok) {
        setError(_('Failed to fetch file from URL: ') + response.statusText);
        return;
      }

      const fileContent = await response.text();
      
      // Validate it's an RSS feed
      if (!fileContent.includes('<rss') && !fileContent.includes('<feed')) {
        setError(_('URL does not contain a valid RSS feed'));
        return;
      }

      // Extract filename from URL or use generic name
      const urlPath = new URL(url).pathname;
      const fileName = urlPath.split('/').pop()?.replace(/\.(rss|xml)$/, '') || _('Remote Feed');

      const newFeed: RSSCatalog = {
        id: `remote-${Date.now()}`,
        name: fileName,
        url: '', // Don't use URL for fetching, use stored content
        description: _('Imported from URL'),
        icon: '🌐',
        category: 'Remote',
        isLocal: false,
        fileContent: fileContent, // Store the fetched XML content
      };

      await saveFeeds([...userFeeds, newFeed]);

      eventDispatcher.dispatch('toast', {
        message: _('RSS feed imported from URL successfully'),
        timeout: 3000,
        type: 'success',
      });

      setCustomURL('');
      setError(null);
    } catch (e) {
      console.error('RSS URL import error:', e);
      setError((e as Error).message || _('Failed to import from URL. Make sure it\'s a direct link to an XML/RSS file.'));
    }
  };

  const handleRemoveCustomFeed = async (feedId: string) => {
    await saveFeeds(userFeeds.filter((f) => f.id !== feedId));
  };

  const handleOpenFeed = (feed: RSSCatalog) => {
    onFeedSelect(feed);
  };

  const groupedFeeds = allFeeds.reduce((acc, feed) => {
    // Apply folder filter
    if (folderFilter && feed.folder !== folderFilter) {
      return acc;
    }
    
    const category = feed.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(feed);
    return acc;
  }, {} as Record<string, RSSCatalog[]>);

  return (
    <div className='flex h-full flex-col'>
      <div className='flex-1 overflow-auto p-6'>
        {/* Sidebar Header with Collapse Toggle */}
        <div className='mb-4 flex items-center justify-between'>
          <h3 className='text-lg font-bold'>{_('RSS Feed Manager')}</h3>
          <button
            className='btn btn-ghost btn-sm'
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? _('Expand') : _('Collapse')}
          >
            {sidebarCollapsed ? <FiChevronRight size={18} /> : <FiChevronLeft size={18} />}
          </button>
        </div>

        {sidebarCollapsed ? (
          <div className='text-center py-8'>
            <FiRss className='mx-auto mb-2 h-12 w-12 text-base-content/30' />
            <p className='text-base-content/50 text-sm'>{_('Sidebar collapsed')}</p>
            <button
              className='btn btn-link btn-sm mt-2'
              onClick={() => setSidebarCollapsed(false)}
            >
              {_('Expand Sidebar')}
            </button>
          </div>
        ) : (
          <>
        {/* Folder Filter */}
        {folders.length > 0 && (
          <div className='mb-4 flex items-center gap-2'>
            <span className='text-sm text-base-content/70'>{_('Filter by folder:')}</span>
            <select 
              className='select select-bordered select-sm'
              value={folderFilter || ''}
              onChange={(e) => setFolderFilter(e.target.value || null)}
            >
              <option value=''>{_('All Folders')}</option>
              {folders.map((folder) => (
                <option key={folder} value={folder}>{folder}</option>
              ))}
            </select>
            {folderFilter && (
              <button className='btn btn-ghost btn-xs' onClick={() => setFolderFilter(null)}>
                <FiTrash2 className='h-3 w-3' />
              </button>
            )}
          </div>
        )}

        {/* Import RSS/OPML File */}
        <div
          className={`card mb-6 transition-all ${isDragging ? 'bg-primary/30 border-4 border-primary scale-[1.02]' : 'bg-base-200 border-2 border-dashed border-base-300'}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className='card-body p-6'>
            <div className='flex flex-col items-center text-center'>
              <FiUpload className={`mb-3 h-12 w-12 ${isDragging ? 'text-primary' : 'text-base-content/50'}`} />
              <h3 className='card-title text-lg'>{_('Import RSS/OPML File')}</h3>
              <p className='text-base-content/70 mt-2 text-sm'>
                {_('Drag and drop your .opml, .rss, or .xml file here')}
              </p>
              <div className='divider my-3'>or</div>
              <div className='flex items-center gap-2'>
                <label className='btn btn-primary btn-sm cursor-pointer'>
                  <FiUpload className='mr-2 h-4 w-4' />
                  {_('Browse Files')}
                  <input
                    type='file'
                    className='hidden'
                    id='rss-file-input'
                    accept='.opml,.rss,.xml,text/xml,application/xml,application/rss+xml'
                    onChange={handleImportRSSFile}
                  />
                </label>
                {isTauriAppPlatform() && (
                  <button className='btn btn-ghost btn-sm' onClick={handleBrowseFiles} title='Use native file picker (shows OPML files)'>
                    📁 Native Picker
                  </button>
                )}
              </div>
              {isDragging && (
                <div className='text-primary mt-3 text-sm font-semibold animate-pulse'>
                  {_('📥 Drop file to import...')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Import RSS File from URL */}
        <div className='card bg-base-200 mb-6'>
          <div className='card-body p-4'>
            <h3 className='card-title text-sm'>{_('Import RSS from XML URL')}</h3>
            <p className='text-base-content/70 text-xs mb-2'>
              {_('Import a static RSS feed file (.xml, .rss) from a URL')}
            </p>
            <div className='flex gap-2'>
              <input
                type='url'
                className='input input-bordered input-sm flex-1'
                placeholder='https://example.com/feed.xml'
                value={customURL}
                onChange={(e) => setCustomURL(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleImportFromURL()}
              />
              <button className='btn btn-secondary btn-sm' onClick={handleImportFromURL}>
                {_('Import File')}
              </button>
            </div>
          </div>
        </div>

        {/* Add Live RSS Feed */}
        <div className='card bg-base-200 mb-6'>
          <div className='card-body p-4'>
            <h3 className='card-title text-sm'>{_('Add Live RSS Feed')}</h3>
            <p className='text-base-content/70 text-xs mb-2'>
              {_('Subscribe to a live RSS/Atom feed that updates automatically')}
            </p>
            <div className='flex gap-2'>
              <input
                type='url'
                className='input input-bordered input-sm flex-1'
                placeholder='https://example.com/rss'
                value={customURL}
                onChange={(e) => setCustomURL(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustomFeed()}
              />
              <button className='btn btn-primary btn-sm' onClick={handleAddCustomFeed}>
                {_('Subscribe')}
              </button>
            </div>
            {error && <p className='text-error text-xs mt-1'>{error}</p>}
          </div>
        </div>

        {/* Feed Categories */}
        {Object.entries(groupedFeeds).map(([category, feeds]) => (
          <div key={category} className='mb-6'>
            <h3 className='text-base-content/70 mb-3 text-sm font-semibold'>{category}</h3>
            <div className='grid grid-cols-1 gap-3'>
              {feeds.map((feed) => {
                const isEnabled = userFeeds.some((f) => f.id === feed.id);
                const isPredefined = ACADEMIC_FEEDS.some((f) => f.id === feed.id);

                return (
                  <div
                    key={feed.id}
                    className={`card ${isEnabled ? 'bg-primary/10' : 'bg-base-200'} cursor-pointer transition-colors hover:bg-base-300`}
                    title={feed.description || feed.name}
                  >
                    <div className='card-body p-4'>
                      <div className='flex items-start gap-3'>
                        <FiRss className='text-base-content/60 mt-0.5 h-5 w-5 flex-shrink-0' />
                        <div className='min-w-0 flex-1'>
                          <h4 className='truncate font-semibold' title={feed.name}>{feed.name}</h4>
                          {feed.folder && (
                            <div className='text-base-content/60 mt-1 flex items-center gap-1 text-xs'>
                              <FiRss className='h-3 w-3' />
                              <span className='truncate' title={feed.folder}>{feed.folder}</span>
                            </div>
                          )}
                          {feed.description && (
                            <p className='text-base-content/60 mt-1 line-clamp-2 text-xs' title={feed.description}>
                              {feed.description}
                            </p>
                          )}
                          {feed.tags && feed.tags.length > 0 && (
                            <div className='mt-2 flex flex-wrap gap-1'>
                              {feed.tags.map((tag, idx) => (
                                <span
                                  key={idx}
                                  className='text-base-content/50 rounded bg-base-300 px-1.5 py-0.5 text-[10px]'
                                  title={tag}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {!isPredefined && (
                        <div className='mt-3 flex items-center justify-between border-t border-base-300 pt-3'>
                          <div className='flex gap-1'>
                            <button
                              className='btn btn-ghost btn-xs'
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditFeed(feed);
                              }}
                              title={_('Edit Feed')}
                            >
                              <FiEdit3 className='h-3 w-3' />
                            </button>
                            <button
                              className='btn btn-ghost btn-xs text-error'
                              onClick={async (e) => {
                                e.stopPropagation();
                                await handleRemoveCustomFeed(feed.id);
                              }}
                              title={_('Delete Feed')}
                            >
                              <FiTrash2 className='h-3 w-3' />
                            </button>
                          </div>
                          <div className='flex gap-1'>
                            <button
                              className={`btn btn-xs ${isEnabled ? 'btn-primary' : 'btn-ghost'}`}
                              onClick={async (e) => {
                                e.stopPropagation();
                                await handleToggleFeed(feed);
                              }}
                            >
                              {isEnabled ? _('Enabled') : _('Enable')}
                            </button>
                            <button
                              className='btn btn-xs btn-ghost'
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenFeed(feed);
                              }}
                            >
                              {_('Open')}
                            </button>
                          </div>
                        </div>
                      )}
                      {isPredefined && (
                        <div className='mt-3 flex items-center justify-end gap-1 border-t border-base-300 pt-3'>
                          <button
                            className={`btn btn-xs ${isEnabled ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={async (e) => {
                              e.stopPropagation();
                              await handleToggleFeed(feed);
                            }}
                          >
                            {isEnabled ? _('Enabled') : _('Enable')}
                          </button>
                          <button
                            className='btn btn-xs btn-ghost'
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenFeed(feed);
                            }}
                          >
                            {_('Open')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
          </>
        )}
      </div>

      {/* Edit Feed Dialog */}
      {editingFeed && (
        <EditFeedDialog
          feed={editingFeed}
          onSave={handleSaveFeed}
          onClose={() => setEditingFeed(null)}
        />
      )}
    </div>
  );
}
