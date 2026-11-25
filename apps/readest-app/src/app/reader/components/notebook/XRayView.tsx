import clsx from 'clsx';
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { LuChevronDown, LuSearch, LuTrash2 } from 'react-icons/lu';
import { Virtuoso } from 'react-virtuoso';

import { useTranslation } from '@/hooks/useTranslation';
import type { XRay } from '@/services/xray/snapshot';
import { XRAY_ENTITY_TYPES, type XRayEntity, type XRayEntityType } from '@/services/xray/types';
import { clearBookXRay, useXRayStore } from '@/services/xray/xrayService';
import { useBookXRay } from '../../hooks/useBookXRay';
import XRayStatus, { XRayMentionList, XRayQuotes, XRayUpdateButton } from '../annotator/XRayStatus';

type Section = XRayEntityType | 'timeline';

const useSectionLabels = (): Record<Section, string> => {
  const _ = useTranslation();
  return {
    character: _('Characters'),
    location: _('Places'),
    organization: _('Organizations'),
    artifact: _('Objects'),
    term: _('Terms'),
    event: _('Events'),
    concept: _('Concepts'),
    timeline: _('Timeline'),
  };
};

const EntityCard: React.FC<{
  bookKey: string;
  xray: XRay;
  entity: XRayEntity;
  isOpen: boolean;
  onToggle: (entity: XRayEntity, open: boolean) => void;
  onSelect: (entity: XRayEntity) => void;
}> = ({ bookKey, xray, entity, isOpen, onToggle, onSelect }) => {
  const _ = useTranslation();
  return (
    <details
      open={isOpen}
      onToggle={(event) => onToggle(entity, event.currentTarget.open)}
      className='group eink-bordered border-base-content/10 rounded-lg border px-3 py-2'
    >
      <summary className='flex cursor-pointer list-none items-start justify-between gap-2 [&::-webkit-details-marker]:hidden'>
        <span className='min-w-0 [overflow-wrap:anywhere]'>
          <span className='font-semibold'>{entity.name}</span>
          {entity.description && <span className='mt-0.5 block text-xs'>{entity.description}</span>}
        </span>
        <LuChevronDown
          aria-hidden='true'
          className='mt-1 size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform'
        />
      </summary>
      {isOpen && (
        <div className='mt-2 space-y-2 text-xs [overflow-wrap:anywhere]'>
          {entity.aliases.length > 0 && (
            <p>
              {_('Also known as')}: {entity.aliases.join(', ')}
            </p>
          )}
          <ul className='list-disc space-y-1 ps-5'>
            {entity.facts.map(({ key, value }) => (
              <li key={`${key}${value}`}>
                {key}: {value}
              </li>
            ))}
            {xray.linksOf(entity).map(({ relationship: { source, type, target }, other }) => (
              <li key={`${source}${type}${target}`}>
                {other ? (
                  <button
                    type='button'
                    className='text-start underline'
                    onClick={() => onSelect(other)}
                  >
                    {source} · {type} · {target}
                  </button>
                ) : (
                  `${source} · ${type} · ${target}`
                )}
              </li>
            ))}
          </ul>
          <XRayMentionList bookKey={bookKey} names={[entity.name, ...entity.aliases]} />
        </div>
      )}
    </details>
  );
};

/** The Notebook's X-Ray tab: who and what the book is about, up to the current page. */
const XRayView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const labels = useSectionLabels();
  const xray = useBookXRay(bookKey);
  const lookup = useXRayStore((s) => s.lookup);
  const [section, setSection] = useState<Section>('character');
  const [query, setQuery] = useState('');
  const [openEntities, setOpenEntities] = useState<ReadonlySet<XRayEntity>>(new Set());
  const filter = useDeferredValue(query.trim().toLocaleLowerCase());

  useEffect(() => {
    useXRayStore.setState({ isDocked: true });
    return () => useXRayStore.setState({ isDocked: false });
  }, []);

  // Kept here, as a card scrolled out of view is unmounted.
  const toggle = (entity: XRayEntity, open: boolean) =>
    setOpenEntities((entities) => {
      if (entities.has(entity) === open) return entities;
      const next = new Set(entities);
      if (open) next.add(entity);
      else next.delete(entity);
      return next;
    });
  const select = (entity: XRayEntity) => {
    setSection(entity.type);
    setQuery(entity.name);
  };
  // A lookup docked here shows its entry.
  useEffect(() => {
    const entity = lookup && xray?.find(lookup.word);
    if (entity) select(entity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup?.id, !xray]);

  const byType = useMemo(() => {
    const groups = new Map<XRayEntityType, XRayEntity[]>();
    for (const entity of xray?.entities ?? []) {
      const group = groups.get(entity.type);
      if (group) group.push(entity);
      else groups.set(entity.type, [entity]);
    }
    return groups;
  }, [xray]);

  if (!xray) return <XRayStatus bookKey={bookKey} word={lookup?.word} />;

  const sections: Section[] = [...XRAY_ENTITY_TYPES.filter((type) => byType.has(type)), 'timeline'];
  const matches = filter
    ? xray.entities.filter((entity) =>
        [entity.name, ...entity.aliases].some((name) => name.toLocaleLowerCase().includes(filter)),
      )
    : section === 'timeline'
      ? []
      : (byType.get(section) ?? []);

  return (
    <div className='flex min-h-0 flex-1 select-text flex-col'>
      <div className='shrink-0 space-y-2 px-3 py-2'>
        <label className='input input-sm eink-bordered border-base-content/20 flex w-full items-center gap-2'>
          <LuSearch aria-hidden='true' className='size-4 shrink-0' />
          <input
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={_('Search')}
            aria-label={_('Search')}
            className='grow'
          />
        </label>
        {!filter && (
          <div className='flex gap-1 overflow-x-auto' role='group' aria-label={_('X-Ray')}>
            {sections.map((id) => (
              <button
                key={id}
                type='button'
                aria-pressed={section === id}
                onClick={() => setSection(id)}
                className={clsx(
                  'min-h-8 shrink-0 rounded-md px-2 text-xs',
                  section === id ? 'bg-base-300/85 eink-bordered' : 'not-eink:hover:bg-base-300/50',
                )}
              >
                {labels[id]}{' '}
                <span className='tabular-nums not-eink:opacity-60'>
                  {id === 'timeline' ? xray.events.length : byType.get(id)!.length}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {filter && matches.length === 0 ? (
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3'>
          <XRayMentionList bookKey={bookKey} names={[query.trim()]} />
        </div>
      ) : (
        <Virtuoso
          // A list of its own: each starts at its top.
          key={filter || section}
          className='min-h-0 flex-1 overscroll-contain'
          totalCount={filter || section !== 'timeline' ? matches.length : xray.events.length}
          increaseViewportBy={200}
          itemContent={(index) => {
            const entity = matches[index];
            const event = xray.events[index];
            return (
              <div className='px-3 pb-2'>
                {entity ? (
                  <EntityCard
                    bookKey={bookKey}
                    xray={xray}
                    entity={entity}
                    isOpen={openEntities.has(entity) || (!!filter && matches.length === 1)}
                    onToggle={toggle}
                    onSelect={select}
                  />
                ) : event ? (
                  <div className='border-base-content/20 border-s ps-3'>
                    <p className='text-sm'>{event.summary}</p>
                    <XRayQuotes bookKey={bookKey} quotes={event.quotes} />
                  </div>
                ) : null}
              </div>
            );
          }}
        />
      )}

      <div className='relative flex shrink-0 justify-center px-3 pb-2'>
        <XRayUpdateButton bookKey={bookKey} />
        <button
          type='button'
          title={_('Clear X-Ray')}
          aria-label={_('Clear X-Ray')}
          onClick={() => void clearBookXRay(bookKey, _('Clear the X-Ray of this book?'))}
          className='btn btn-ghost btn-sm btn-square absolute end-3'
        >
          <LuTrash2 className='size-4' />
        </button>
      </div>
    </div>
  );
};

export default XRayView;
