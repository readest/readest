'use client';

import { useState } from 'react';
import { RSSCatalog } from '@/types/rss';
import { FiFolder, FiChevronRight, FiChevronDown, FiEdit, FiTrash, FiFileText } from 'react-icons/fi';

interface FolderNode {
  name: string;
  feeds: RSSCatalog[];
  subfolders: FolderNode[];
  path: string;
}

interface FolderTreeItemProps {
  folder: FolderNode;
  selectedFeed: RSSCatalog | null;
  onFeedSelect: (feed: RSSCatalog) => void;
  onEditFeed: (feed: RSSCatalog) => void;
  onDeleteFeed: (feedId: string) => void;
  depth?: number;
}

function FolderTreeItem({
  folder,
  selectedFeed,
  onFeedSelect,
  onEditFeed,
  onDeleteFeed,
  depth = 0,
}: FolderTreeItemProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasSubfolders = folder.subfolders.length > 0;
  const hasFeeds = folder.feeds.length > 0;

  return (
    <div className="select-none">
      {/* Folder Header */}
      {(hasSubfolders || hasFeeds) && (
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-base-300"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {hasSubfolders ? (
            isExpanded ? (
              <FiChevronDown className="h-4 w-4 flex-shrink-0" />
            ) : (
              <FiChevronRight className="h-4 w-4 flex-shrink-0" />
            )
          ) : (
            <div className="h-4 w-4" />
          )}
          <FiFolder className={`h-4 w-4 flex-shrink-0 ${isExpanded ? 'text-primary' : 'text-base-content/70'}`} />
          <span className="font-medium truncate">{folder.name}</span>
          <span className="text-base-content/50 text-xs ml-auto">
            ({folder.feeds.length + folder.subfolders.reduce((acc, f) => acc + f.feeds.length, 0)})
          </span>
        </button>
      )}

      {/* Subfolders */}
      {isExpanded && hasSubfolders && (
        <div>
          {folder.subfolders.map((subfolder) => (
            <FolderTreeItem
              key={subfolder.path}
              folder={subfolder}
              selectedFeed={selectedFeed}
              onFeedSelect={onFeedSelect}
              onEditFeed={onEditFeed}
              onDeleteFeed={onDeleteFeed}
              depth={depth + 1}
            />
          ))}
        </div>
      )}

      {/* Feeds in this folder */}
      {isExpanded && hasFeeds && (
        <div>
          {folder.feeds.map((feed) => (
            <div
              key={feed.id}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-base-300 ${
                selectedFeed?.id === feed.id ? 'bg-base-300' : ''
              }`}
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              onClick={() => onFeedSelect(feed)}
            >
              <FiFileText className="text-base-content/70 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{feed.name}</div>
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
    </div>
  );
}

interface FolderTreeProps {
  feeds: RSSCatalog[];
  selectedFeed: RSSCatalog | null;
  onFeedSelect: (feed: RSSCatalog) => void;
  onEditFeed: (feed: RSSCatalog) => void;
  onDeleteFeed: (feedId: string) => void;
}

export function FolderTree({
  feeds,
  selectedFeed,
  onFeedSelect,
  onEditFeed,
  onDeleteFeed,
}: FolderTreeProps) {
  // Build folder tree from feeds
  const buildFolderTree = (feedsList: RSSCatalog[]): FolderNode[] => {
    const root: FolderNode[] = [];

    feedsList.forEach((feed) => {
      const folderPath = feed.folder || 'Uncategorized';
      const parts = folderPath.split('/').filter(Boolean);

      let currentLevel = root;
      let currentPath = '';

      parts.forEach((part, index) => {
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        let folderNode = currentLevel.find((f) => f.name === part);
        if (!folderNode) {
          folderNode = {
            name: part,
            feeds: [],
            subfolders: [],
            path: currentPath,
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

  const folderTree = buildFolderTree(feeds);

  return (
    <div className="py-2">
      {folderTree.map((folder) => (
        <FolderTreeItem
          key={folder.path}
          folder={folder}
          selectedFeed={selectedFeed}
          onFeedSelect={onFeedSelect}
          onEditFeed={onEditFeed}
          onDeleteFeed={onDeleteFeed}
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
