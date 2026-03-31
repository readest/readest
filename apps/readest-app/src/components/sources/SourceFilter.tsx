/**
 * Source Filter Component
 * Allows users to select which sources to include/exclude
 */

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { SourceProvider, SourceProviderType } from '@/types/sources';
import { getProviderIcon, getSourceTypeBadgeColor } from './SourceIcons';
import { IoCheckmark, IoClose, IoSearch } from 'react-icons/io5';

interface SourceFilterProps {
  sources: SourceProvider[];
  selectedSources: string[];
  excludedSources: string[];
  onSelectedSourcesChange: (sources: string[]) => void;
  onExcludedSourcesChange: (sources: string[]) => void;
}

export default function SourceFilter({
  sources,
  selectedSources,
  excludedSources,
  onSelectedSourcesChange,
  onExcludedSourcesChange,
}: SourceFilterProps) {
  const _ = useTranslation();
  const [filterQuery, setFilterQuery] = useState('');

  // Group sources by type
  const groupedSources = sources.reduce((acc, source) => {
    if (!acc[source.type]) {
      acc[source.type] = [];
    }
    acc[source.type].push(source);
    return acc;
  }, {} as Record<SourceProviderType, SourceProvider[]>);

  // Filter sources
  const filteredSources = sources.filter(source =>
    source.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
    source.description?.toLowerCase().includes(filterQuery.toLowerCase())
  );

  const toggleSource = (sourceId: string) => {
    if (selectedSources.includes(sourceId)) {
      onSelectedSourcesChange(selectedSources.filter(id => id !== sourceId));
    } else {
      onSelectedSourcesChange([...selectedSources, sourceId]);
      // Remove from excluded if present
      if (excludedSources.includes(sourceId)) {
        onExcludedSourcesChange(excludedSources.filter(id => id !== sourceId));
      }
    }
  };

  const toggleExcluded = (sourceId: string) => {
    if (excludedSources.includes(sourceId)) {
      onExcludedSourcesChange(excludedSources.filter(id => id !== sourceId));
    } else {
      onExcludedSourcesChange([...excludedSources, sourceId]);
      // Remove from selected if present
      if (selectedSources.includes(sourceId)) {
        onSelectedSourcesChange(selectedSources.filter(id => id !== sourceId));
      }
    }
  };

  return (
    <div className='mt-2 rounded-lg border border-base-300 bg-base-100 p-3'>
      {/* Search filter */}
      <div className='mb-2 relative'>
        <IoSearch className='text-base-content/50 absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2' />
        <input
          type='text'
          value={filterQuery}
          onChange={e => setFilterQuery(e.target.value)}
          placeholder={_('Filter sources...')}
          className='input input-xs h-7 w-full rounded-lg border-0 bg-base-200 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-primary'
        />
      </div>

      {/* Sources by type - compact list */}
      <div className='max-h-64 overflow-y-auto'>
        <div className='space-y-2'>
          {Object.entries(groupedSources).map(([type, typeSources]) => {
            const filteredTypeSources = typeSources.filter(s =>
              filteredSources.includes(s)
            );

            if (filteredTypeSources.length === 0) return null;

            return (
              <div key={type}>
                <div className='mb-1 flex items-center justify-between'>
                  <h4 className='text-xs font-semibold capitalize text-base-content/70'>
                    {type.replace('_', ' ')}
                  </h4>
                  <span className='badge badge-xs badge-ghost'>
                    {filteredTypeSources.length}
                  </span>
                </div>
                <div className='space-y-0.5'>
                  {filteredTypeSources.map(source => {
                    const Icon = getProviderIcon(source.id, source.type);
                    const isSelected = selectedSources.includes(source.id);
                    const isExcluded = excludedSources.includes(source.id);

                    return (
                      <div
                        key={source.id}
                        className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
                          isExcluded
                            ? 'bg-error/10 text-error/70'
                            : isSelected
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-base-200'
                        }`}
                        onClick={() => toggleSource(source.id)}
                      >
                        <div className='flex items-center gap-2'>
                          <Icon className='h-3.5 w-3.5' />
                          <span className='font-medium'>{source.name}</span>
                          {source.mirrorCount && (
                            <span className='text-base-content/50 text-xs'>
                              ({source.mirrorCount})
                            </span>
                          )}
                        </div>
                        <div className='flex items-center gap-1'>
                          {isSelected && (
                            <IoCheckmark className='text-primary h-3.5 w-3.5' />
                          )}
                          {isExcluded && (
                            <IoClose className='text-error h-3.5 w-3.5' />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div className='mt-2 flex justify-end gap-1 border-t border-base-300 pt-2'>
        <button
          onClick={() => {
            onSelectedSourcesChange([]);
            onExcludedSourcesChange([]);
          }}
          className='btn btn-ghost btn-xs'
        >
          {_('Reset')}
        </button>
        <button
          onClick={() => {
            onSelectedSourcesChange(sources.map(s => s.id));
            onExcludedSourcesChange([]);
          }}
          className='btn btn-ghost btn-xs'
        >
          {_('Select All')}
        </button>
        <button
          onClick={() => {
            onSelectedSourcesChange([]);
            onExcludedSourcesChange(sources.map(s => s.id));
          }}
          className='btn btn-ghost btn-xs'
        >
          {_('Exclude All')}
        </button>
      </div>
    </div>
  );
}
