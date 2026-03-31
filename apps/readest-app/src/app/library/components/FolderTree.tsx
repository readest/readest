'use client';

import { useState } from 'react';
import { RSSCatalog } from '@/types/rss';
import { FiFolder, FiChevronRight, FiChevronDown, FiEdit, FiTrash, FiFileText, FiInbox } from 'react-icons/fi';

interface FolderNode {
  name: string;
  feeds: RSSCatalog[];
  subfolders: FolderNode[];
  path: string;
  color?: string; // Folder color
}

interface FolderTreeItemProps {
  folder: FolderNode;
  selectedFeed: RSSCatalog | null;
  moveFeedId?: string | null;
  onFeedSelect: (feed: RSSCatalog) => void;
  onFolderSelect: (folderPath: string) => void;
  onEditFeed: (feed: RSSCatalog) => void;
  onDeleteFeed: (feedId: string) => void;
  onTogglePriority: (feedId: string) => void;
  onAddFolder?: (parentPath: string) => void;
  onDeleteFolder?: (folderPath: string) => void;
  onEditFolder?: (folderPath: string) => void;
  onMoveFeed?: (feedId: string, newFolder: string) => void;
  onStartMoveFeed?: (feedId: string) => void;
  onCancelMoveFeed?: () => void;
  depth?: number;
}

function FolderTreeItem({
  folder,
  selectedFeed,
  moveFeedId,
  onFeedSelect,
  onFolderSelect,
  onEditFeed,
  onDeleteFeed,
  onTogglePriority,
  onAddFolder,
  onDeleteFolder,
  onEditFolder,
  onMoveFeed,
  onStartMoveFeed,
  onCancelMoveFeed,
  depth = 0,
}: FolderTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDragOver, setIsDragOver] = useState(false);
  const hasSubfolders = folder.subfolders.length > 0;
  const hasFeeds = folder.feeds.length > 0;

  // Handle click-to-move: click folder to drop feed
  const handleFolderClick = () => {
    if (moveFeedId && onMoveFeed) {
      onMoveFeed(moveFeedId, folder.path);
    }
  };

  return (
    <div className="select-none group">
      {/* Folder row - entire row is drop zone */}
      <div
        className="flex items-center gap-1 rounded-lg transition-colors mb-0.5 cursor-pointer"
        style={{
          backgroundColor: moveFeedId 
            ? 'rgba(34, 197, 94, 0.2)' // Green tint when ready to receive feed
            : isDragOver 
              ? 'rgba(59, 130, 246, 0.3)' 
              : undefined,
          outline: moveFeedId || isDragOver ? '2px solid rgb(59, 130, 246)' : 'none',
          outlineOffset: '-2px',
          pointerEvents: 'auto',
        }}
        onClick={handleFolderClick}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const feedId = e.dataTransfer.getData('text/plain');
          console.log('[Folder] Drag over:', folder.path, 'feedId:', feedId);
          if (feedId) {
            e.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
          }
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOver(false);
          const feedId = e.dataTransfer.getData('text/plain');
          console.log('[Folder] DROP:', folder.path, 'feedId:', feedId);
          if (feedId && onMoveFeed) {
            onMoveFeed(feedId, folder.path);
          }
        }}
      >
        {/* Expand button */}
        <button
          className="z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-base-300"
          style={{ marginLeft: `${depth * 12}px` }}
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded ? (
            <FiChevronDown className="h-4 w-4" />
          ) : (
            <FiChevronRight className="h-4 w-4" />
          )}
        </button>
        
        {/* Folder icon and name */}
        <div className="flex flex-1 items-center gap-2 py-1">
          <FiFolder 
            className={`flex-shrink-0 ${depth > 0 ? 'h-3 w-3' : 'h-4 w-4'}`} 
            style={{ color: folder.color || (isExpanded ? '#3b82f6' : undefined) }}
          />
          <span className={`flex-1 truncate font-medium ${depth > 0 ? 'text-sm' : 'text-base'}`}>{folder.name}</span>
          <span className="text-base-content/50 text-xs">
            ({folder.feeds.length + folder.subfolders.reduce((acc, f) => acc + f.feeds.length, 0)})
          </span>
        </div>
        
        {/* Action buttons - only visible on hover */}
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onFolderSelect(folder.path);
            }}
            title="View all feeds in this folder"
          >
            <FiInbox className="h-3 w-3" />
          </button>
          {onAddFolder && (
            <button
              className="btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onAddFolder(folder.path);
              }}
              title="Add subfolder"
            >
              <FiFolder className="h-3 w-3" />
            </button>
          )}
          {onEditFolder && (
            <button
              className="btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onEditFolder?.(folder.path);
              }}
              title="Edit folder"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>
          )}
          {onDeleteFolder && (
            <button
              className="btn btn-ghost btn-xs h-6 min-h-6 w-6 p-0 text-error"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete folder "${folder.path}"? Feeds in this folder will be moved to Uncategorized.`)) {
                  onDeleteFolder(folder.path);
                }
              }}
              title="Delete folder"
            >
              <FiTrash className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Feeds in this folder */}
      {isExpanded && hasFeeds && (
        <div className="pointer-events-auto">
          {folder.feeds.map((feed) => (
            <div
              key={feed.id}
              className={`group flex cursor-grab active:cursor-grabbing pointer-events-auto items-center gap-2 rounded-lg px-2 py-2 hover:bg-base-300 ${
                selectedFeed?.id === feed.id ? 'bg-base-300' : ''
              }`}
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              onClick={() => onFeedSelect(feed)}
              draggable
              onDragStart={(e) => {
                console.log('[Feed] Drag started for:', feed.id, feed.name);
                e.dataTransfer.setData('text/plain', feed.id);
                e.dataTransfer.setData('feedId', feed.id);
                e.dataTransfer.setData('fromFolder', feed.folder || '');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.dropEffect = 'move';
                // Set drag image
                const dragImage = e.target as HTMLElement;
                e.dataTransfer.setDragImage(dragImage, 20, 20);
              }}
              onDragEnd={() => {
                console.log('[Feed] Drag ended for:', feed.id);
              }}
            >
              <FiFileText className="h-4 w-4 flex-shrink-0" style={{ color: feed.color || undefined }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  {feed.priority && (
                    <span className="text-base-content flex-shrink-0" title="Priority feed">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    </span>
                  )}
                  <div className="truncate text-sm font-medium">{feed.name}</div>
                </div>
                {feed.tags && feed.tags.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {feed.tags.slice(0, 3).map((tag, idx) => (
                      <span
                        key={idx}
                        className="text-base-content/50 truncate rounded bg-base-300 px-1 text-[10px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {/* Move button */}
                <button
                  className={`btn btn-ghost btn-xs h-5 min-h-5 w-5 p-0 ${moveFeedId === feed.id ? 'text-success' : 'text-base-content/50'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (moveFeedId === feed.id) {
                      onCancelMoveFeed?.();
                    } else {
                      onStartMoveFeed?.(feed.id);
                    }
                  }}
                  title={moveFeedId === feed.id ? "Cancel move" : "Move to folder"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M5 2.914V3H3a1 1 0 00-1 1v12a1 1 0 102 0V4h2V2.914a1 1 0 00-2 0z" clipRule="evenodd" />
                  </svg>
                </button>
                {/* Priority button */}
                <button
                  className={`btn btn-ghost btn-xs h-5 min-h-5 w-5 p-0 ${feed.priority ? 'text-base-content' : 'text-base-content/50'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePriority(feed.id);
                  }}
                  title={feed.priority ? "Remove from priority" : "Set as priority feed"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </button>
                <button
                  className="btn btn-ghost btn-xs h-5 min-h-5 w-5 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditFeed(feed);
                  }}
                  title="Edit Feed"
                >
                  <FiEdit className="h-3 w-3" />
                </button>
                <button
                  className="btn btn-ghost btn-xs h-5 min-h-5 w-5 p-0 text-error"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFeed(feed.id);
                  }}
                  title="Delete Feed"
                >
                  <FiTrash className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subfolders - rendered after feeds */}
      {isExpanded && hasSubfolders && (
        <div>
          {folder.subfolders.map((subfolder) => (
            <FolderTreeItem
              key={subfolder.path}
              folder={subfolder}
              selectedFeed={selectedFeed}
              moveFeedId={moveFeedId}
              onFeedSelect={onFeedSelect}
              onFolderSelect={onFolderSelect}
              onEditFeed={onEditFeed}
              onDeleteFeed={onDeleteFeed}
              onTogglePriority={onTogglePriority}
              onAddFolder={onAddFolder}
              onDeleteFolder={onDeleteFolder}
              onEditFolder={onEditFolder}
              onMoveFeed={onMoveFeed}
              onStartMoveFeed={onStartMoveFeed}
              onCancelMoveFeed={onCancelMoveFeed}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FolderTreeProps {
  feeds: RSSCatalog[];
  folders: string[]; // List of folder paths
  folderColors?: Record<string, string>; // Map of folder path to color
  selectedFeed: RSSCatalog | null;
  moveFeedId?: string | null; // Feed being moved (click-to-move mode)
  onFeedSelect: (feed: RSSCatalog) => void;
  onFolderSelect: (folderPath: string) => void;
  onEditFeed: (feed: RSSCatalog) => void;
  onDeleteFeed: (feedId: string) => void;
  onTogglePriority: (feedId: string) => void;
  onAddFolder?: (parentPath: string) => void;
  onDeleteFolder?: (folderPath: string) => void;
  onEditFolder?: (folderPath: string) => void;
  onMoveFeed?: (feedId: string, newFolder: string) => void;
  onStartMoveFeed?: (feedId: string) => void;
  onCancelMoveFeed?: () => void;
}

export function FolderTree({
  feeds,
  folders,
  folderColors,
  selectedFeed,
  moveFeedId,
  onFeedSelect,
  onFolderSelect,
  onEditFeed,
  onDeleteFeed,
  onTogglePriority,
  onAddFolder,
  onDeleteFolder,
  onEditFolder,
  onMoveFeed,
  onStartMoveFeed,
  onCancelMoveFeed,
}: FolderTreeProps) {
  console.log('[FolderTree] folderColors:', folderColors);
  
  // Build folder tree from folders list and feeds
  // Note: onEditFolder and onDeleteFolder are passed to FolderTreeItem children
  void onEditFolder;
  void onDeleteFolder;

  const buildFolderTree = (foldersList: string[], feedsList: RSSCatalog[]): FolderNode[] => {
    const root: FolderNode[] = [];
    console.log('[FolderTree] Building tree with folders:', foldersList);

    // First create all folders
    foldersList.forEach((folderPath) => {
      const parts = folderPath.split('/').filter(Boolean);
      let currentLevel = root;
      let currentPath = '';

      parts.forEach((part) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        let folderNode = currentLevel.find((f) => f.name === part);
        if (!folderNode) {
          folderNode = {
            name: part,
            feeds: [],
            subfolders: [],
            path: currentPath,
            color: folderColors?.[currentPath], // Get color from folderColors map
          };
          console.log('[FolderTree] Created folder:', currentPath, 'with color:', folderColors?.[currentPath]);
          currentLevel.push(folderNode);
        }
        currentLevel = folderNode.subfolders;
      });
    });

    // Then add feeds to their folders
    feedsList.forEach((feed) => {
      if (!feed.folder) return;
      const parts = feed.folder.split('/').filter(Boolean);
      let currentLevel = root;
      let currentPath = '';

      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        let folderNode = currentLevel.find((f) => f.name === part);
        if (!folderNode) {
          // Create folder if it doesn't exist (for feeds without explicit folder)
          folderNode = {
            name: part,
            feeds: [],
            subfolders: [],
            path: currentPath,
            color: folderColors?.[currentPath], // Get color from folderColors map
          };
          currentLevel.push(folderNode);
        }
        // If this is the last part, add the feed to this folder
        if (index === parts.length - 1) {
          folderNode.feeds.push(feed);
        }
        currentLevel = folderNode.subfolders;
      });
    });

    // Sort folders alphabetically
    const sortTree = (nodes: FolderNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      nodes.forEach((node) => sortTree(node.subfolders));
    };

    sortTree(root);
    return root;
  };

  const folderTree = buildFolderTree(folders, feeds);

  return (
    <div className="py-2">
      {folderTree.map((folder) => (
        <FolderTreeItem
          key={folder.path}
          folder={folder}
          selectedFeed={selectedFeed}
          moveFeedId={moveFeedId}
          onFeedSelect={onFeedSelect}
          onFolderSelect={onFolderSelect}
          onEditFeed={onEditFeed}
          onDeleteFeed={onDeleteFeed}
          onTogglePriority={onTogglePriority}
          onAddFolder={onAddFolder}
          onDeleteFolder={onDeleteFolder}
          onEditFolder={onEditFolder}
          onMoveFeed={onMoveFeed}
          onStartMoveFeed={onStartMoveFeed}
          onCancelMoveFeed={onCancelMoveFeed}
        />
      ))}

      {folderTree.length === 0 && (
        <div className="p-4 text-center text-base-content/60">
          <p className="text-sm">No feeds yet</p>
        </div>
      )}
    </div>
  );
}
