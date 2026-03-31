'use client';

import React from 'react';
import { SourceSearchResult } from '@/types/sources';

/**
 * LibGen Result Table Component
 * Matches libgen.li table layout with all columns visible
 */

export interface LibGenResultTableProps {
  results: SourceSearchResult[];
  onDownload: (result: SourceSearchResult) => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}

const LibGenResultTable: React.FC<LibGenResultTableProps> = ({
  results,
  onDownload,
  sortField = 'id',
  sortDirection = 'desc',
  onSort,
}) => {
  const renderSortIcon = (field: string) => {
    if (sortField !== field) return ' ↕';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const handleSort = (field: string) => {
    if (onSort) {
      onSort(field);
    }
  };

  return (
    <div className="overflow-x-auto w-full">
      <table className="table table-zebra w-full text-xs">
        <thead>
          <tr className="bg-base-200">
            <th className="px-2 py-2 w-[60px]">Cover</th>
            <th className="px-2 py-2 min-w-[250px] cursor-pointer hover:bg-base-300" onClick={() => handleSort('title')}>
              Title ↕
            </th>
            <th className="px-2 py-2 min-w-[180px] cursor-pointer hover:bg-base-300" onClick={() => handleSort('author')}>
              Author(s) ↕
            </th>
            <th className="px-2 py-2 min-w-[150px] cursor-pointer hover:bg-base-300" onClick={() => handleSort('publisher')}>
              Publisher ↕
            </th>
            <th className="px-2 py-2 w-[60px] cursor-pointer hover:bg-base-300" onClick={() => handleSort('year')}>
              Year ↕
            </th>
            <th className="px-2 py-2 w-[80px]">Language</th>
            <th className="px-2 py-2 w-[70px] cursor-pointer hover:bg-base-300" onClick={() => handleSort('size')}>
              Size ↕
            </th>
            <th className="px-2 py-2 w-[50px] cursor-pointer hover:bg-base-300" onClick={() => handleSort('extension')}>
              Ext ↕
            </th>
            <th className="px-2 py-2 w-[100px]">Download</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, index) => (
            <LibGenResultRow
              key={`${result.sourceId}-${result.id}-${index}`}
              result={result}
              onDownload={onDownload}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Individual result row component
 */
const LibGenResultRow: React.FC<{
  result: SourceSearchResult;
  onDownload: (result: SourceSearchResult) => void;
}> = ({ result, onDownload }) => {
  const { extensionData } = result;
  const md5 = extensionData?.md5 || '';
  
  // Construct cover URL from MD5 - use https to avoid mixed content issues
  const coverUrl = result.coverUrl || (md5 && md5.length >= 2 
    ? `https://libgen.li/covers/${md5.substring(0, 2)}/${md5}.1.jpg`
    : null);

  return (
    <tr className="hover:bg-base-200">
      {/* Cover image column */}
      <td className="px-2 py-2">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="w-10 h-14 object-cover rounded border border-base-300"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-10 h-14 bg-base-300 rounded flex items-center justify-center">
            <span className="text-xs text-base-content/30">📄</span>
          </div>
        )}
      </td>

      {/* Title with series, ISBN, file ID */}
      <td className="px-2 py-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          {/* Series above title */}
          {result.extensionData?.series && (
            <span className="text-xs font-bold text-base-content/70">
              {result.extensionData.series}
            </span>
          )}
          {/* Title as blue link */}
          <a
            href={result.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="link link-primary hover:underline font-medium text-sm break-words"
            title={result.title}
          >
            {result.title}
          </a>
          {/* ISBN in green below title */}
          {(result.extensionData?.isbn || extensionData?.isbn) && (
            <span className="text-xs text-success font-mono break-all">
              {result.extensionData?.isbn || extensionData?.isbn}
            </span>
          )}
          {/* File ID badge */}
          {md5 && (
            <div className="flex gap-1 mt-0.5">
              <span className="badge badge-xs badge-secondary h-4">
                b {md5.substring(0, 8)}
              </span>
            </div>
          )}
        </div>
      </td>

      {/* Author(s) */}
      <td className="px-2 py-2">
        <div className="text-xs break-words" title={result.authors?.join('; ')}>
          {result.authors ? result.authors.join('; ') : '-'}
        </div>
      </td>

      {/* Publisher */}
      <td className="px-2 py-2">
        <span className="text-xs break-words" title={result.publisher}>
          {result.publisher || '-'}
        </span>
      </td>

      {/* Year */}
      <td className="px-2 py-2 text-right">
        <span className="text-xs">{result.year || '-'}</span>
      </td>

      {/* Language */}
      <td className="px-2 py-2">
        <span className="text-xs capitalize">{result.language || '-'}</span>
      </td>

      {/* Size */}
      <td className="px-2 py-2 text-right">
        <span className="text-xs font-mono">{result.size || '-'}</span>
      </td>

      {/* Extension */}
      <td className="px-2 py-2 text-center">
        <span className="text-xs font-mono uppercase bg-base-200 px-1.5 py-0.5 rounded">
          {result.format || '-'}
        </span>
      </td>

      {/* Download button - opens LibGen download page */}
      <td className="px-2 py-2">
        <a
          href={result.downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-xs btn-primary gap-1 h-6 min-h-6 px-2"
          title="Download from LibGen"
        >
          ⬇ Download
        </a>
      </td>
    </tr>
  );
};

export default LibGenResultTable;
