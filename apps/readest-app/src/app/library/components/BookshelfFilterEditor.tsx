import { useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { IoMdCloseCircleOutline } from 'react-icons/io';
import { MdInfoOutline } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import type { BookshelfFilterGroup, BookshelfRule, BookshelfOperator } from '@/types/bookshelf';
import {
  bookshelfFieldOperators,
  getBookshelfField,
  BOOKSHELF_OPERATOR_LABELS,
  type BookshelfField,
} from '@/services/bookshelves/fields';

export default function BookshelfFilterEditor({
  group,
  fields,
  onChange,
  depth = 0,
}: {
  group: BookshelfFilterGroup;
  fields: BookshelfField[];
  onChange: (group: BookshelfFilterGroup) => void;
  depth?: number;
}) {
  const _ = useTranslation();
  const [showHelp, setShowHelp] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const addRuleRef = useRef<HTMLButtonElement>(null);
  const changeChild = (index: number, node: BookshelfRule | BookshelfFilterGroup) =>
    onChange({
      ...group,
      children: group.children.map((child, i) => (i === index ? node : child)),
    });
  const addRule = () =>
    onChange({
      ...group,
      children: [
        ...group.children,
        { type: 'rule', field: 'title', kind: 'text', operator: 'contains', value: '' },
      ],
    });
  return (
    <fieldset className='eink-bordered border-base-200 min-w-0 rounded-lg border px-4 py-3'>
      <legend className='-ms-1 px-1 text-sm'>{depth ? _('Filter group') : _('Filters')}</legend>
      <div className='mb-3 flex items-center gap-2'>
        <label className='flex min-w-0 flex-1 items-center gap-2 text-sm'>
          {_('Match')}
          <select
            aria-label={_('Match conditions')}
            className='select eink-bordered border-base-200 min-w-0'
            value={group.match}
            onChange={(e) => onChange({ ...group, match: e.target.value as 'all' | 'any' })}
          >
            <option value='all'>{_('All conditions (AND)')}</option>
            <option value='any'>{_('Any condition (OR)')}</option>
          </select>
        </label>
        <Tooltip.Provider>
          <Tooltip.Root open={showHelp} onOpenChange={setShowHelp}>
            <Tooltip.Trigger asChild>
              <button
                ref={helpButtonRef}
                type='button'
                aria-label={_('Filter help')}
                className='btn btn-ghost btn-circle eink-bordered h-11 min-h-11 w-11 shrink-0'
                onClick={(event) => {
                  event.preventDefault();
                  setShowHelp(true);
                }}
              >
                <MdInfoOutline aria-hidden className='text-base-content/75 h-5 w-5' />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal container={helpButtonRef.current?.closest('dialog') ?? undefined}>
              <Tooltip.Content
                side='bottom'
                align='end'
                sideOffset={8}
                collisionPadding={16}
                onEscapeKeyDown={(event) => event.stopPropagation()}
                className='bg-base-100 text-base-content eink-bordered border-base-200 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-3 rounded-lg border p-4 text-sm shadow-lg'
              >
                <p>{_('Use Add condition to choose a field, a comparison, and a value')}</p>
                <p>
                  {_(
                    'All conditions (AND) requires every condition to match. Any condition (OR) requires at least one match.',
                  )}
                </p>
                <p>
                  {_(
                    'Use Add filter group to nest conditions with their own AND or OR setting. For example, match unread books AND a group of two authors joined by OR.',
                  )}
                </p>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
      <div className='space-y-3'>
        {group.children.map((child, index) => (
          <div key={index} className='flex min-w-0 items-start gap-2'>
            <div className='min-w-0 flex-1'>
              {child.type === 'group' ? (
                <BookshelfFilterEditor
                  group={child}
                  fields={fields}
                  depth={depth + 1}
                  onChange={(value) => changeChild(index, value)}
                />
              ) : (
                <div className='grid min-w-0 gap-2 sm:grid-cols-3'>
                  <select
                    aria-label={_('Filter field')}
                    className='select eink-bordered border-base-200 w-full min-w-0'
                    value={child.field}
                    onChange={(e) => {
                      const field = fields.find((f) => f.id === e.target.value)!;
                      changeChild(index, {
                        type: 'rule',
                        field: field.id,
                        kind: field.kind,
                        operator: bookshelfFieldOperators(field.id, field.kind)[0]!,
                        value: field.kind === 'boolean' ? true : field.choices?.[0]?.value,
                      });
                    }}
                  >
                    {!fields.some((f) => f.id === child.field) && (
                      <option value={child.field}>
                        {_('Missing column: {{name}}', {
                          name: child.field.replace('calibre:', ''),
                        })}
                      </option>
                    )}
                    {fields.map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.id.startsWith('calibre:') ? field.label : _(field.label)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={_('Filter comparison')}
                    className='select eink-bordered border-base-200 w-full min-w-0'
                    value={child.operator}
                    onChange={(e) =>
                      changeChild(index, {
                        ...child,
                        operator: e.target.value as BookshelfOperator,
                        ...(e.target.value === 'withinLast'
                          ? { value: 30, unit: 'days' }
                          : child.operator === 'withinLast'
                            ? { value: undefined, unit: undefined }
                            : {}),
                      })
                    }
                  >
                    {bookshelfFieldOperators(child.field, child.kind).map((operator) => (
                      <option key={operator} value={operator}>
                        {_(BOOKSHELF_OPERATOR_LABELS[operator])}
                      </option>
                    ))}
                  </select>
                  {!['set', 'unset'].includes(child.operator) &&
                    (child.operator === 'withinLast' ? (
                      <div className='grid min-w-0 grid-cols-[minmax(3rem,1fr)_minmax(0,2fr)] gap-2'>
                        <input
                          aria-label={_('Time period')}
                          className='input eink-bordered border-base-200 w-full min-w-0 px-3'
                          type='number'
                          min={1}
                          step={1}
                          value={typeof child.value === 'number' ? child.value : ''}
                          onChange={(e) =>
                            changeChild(index, {
                              ...child,
                              value: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                        />
                        <select
                          aria-label={_('Time unit')}
                          className='select eink-bordered border-base-200 w-full min-w-0 ps-3'
                          value={child.unit}
                          onChange={(e) =>
                            changeChild(index, {
                              ...child,
                              unit: e.target.value as BookshelfRule['unit'],
                            })
                          }
                        >
                          <option value='days'>{_('Days')}</option>
                          <option value='months'>{_('Months')}</option>
                          <option value='years'>{_('Years')}</option>
                        </select>
                      </div>
                    ) : getBookshelfField(child.field, child.kind)?.choices ? (
                      <select
                        aria-label={_('Filter value')}
                        className='select eink-bordered border-base-200 w-full min-w-0'
                        value={String(child.value ?? '')}
                        onChange={(e) => changeChild(index, { ...child, value: e.target.value })}
                      >
                        {getBookshelfField(child.field, child.kind)!.choices!.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {_(choice.label)}
                          </option>
                        ))}
                      </select>
                    ) : child.kind === 'boolean' ? (
                      <select
                        aria-label={_('Filter value')}
                        className='select eink-bordered border-base-200 w-full min-w-0'
                        value={String(child.value ?? true)}
                        onChange={(e) =>
                          changeChild(index, { ...child, value: e.target.value === 'true' })
                        }
                      >
                        <option value='true'>{_('Yes')}</option>
                        <option value='false'>{_('No')}</option>
                      </select>
                    ) : (
                      <input
                        aria-label={_('Filter value')}
                        className='input eink-bordered border-base-200 w-full min-w-0'
                        type={
                          child.kind === 'number'
                            ? 'number'
                            : child.kind === 'date'
                              ? 'date'
                              : 'text'
                        }
                        value={String(child.value ?? '')}
                        onChange={(e) =>
                          changeChild(index, {
                            ...child,
                            value:
                              child.kind === 'number'
                                ? e.target.value === ''
                                  ? undefined
                                  : Number(e.target.value)
                                : e.target.value,
                          })
                        }
                      />
                    ))}
                </div>
              )}
            </div>
            <button
              type='button'
              aria-label={child.type === 'group' ? _('Remove filter group') : _('Remove condition')}
              title={child.type === 'group' ? _('Remove filter group') : _('Remove condition')}
              className='btn btn-ghost btn-circle eink-bordered h-11 min-h-11 w-11 shrink-0'
              onClick={() => {
                onChange({ ...group, children: group.children.filter((_child, i) => i !== index) });
                // Children are keyed by index, so this button now belongs to the next condition.
                addRuleRef.current?.focus();
              }}
            >
              <IoMdCloseCircleOutline aria-hidden className='text-base-content/75 h-5 w-5' />
            </button>
          </div>
        ))}
      </div>
      {!group.children.length && (
        <p className='text-base-content/60 py-2 text-sm'>
          {depth ? _('Add a condition to this group') : _('No filters: matches all books')}
        </p>
      )}
      <div className='mt-2 flex flex-wrap gap-x-6'>
        <button
          ref={addRuleRef}
          type='button'
          className='min-h-11 cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
          onClick={addRule}
        >
          {_('Add condition')}
        </button>
        {depth < 6 && (
          <button
            type='button'
            className='min-h-11 cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
            onClick={() =>
              onChange({
                ...group,
                children: [...group.children, { type: 'group', match: 'any', children: [] }],
              })
            }
          >
            {_('Add filter group')}
          </button>
        )}
      </div>
    </fieldset>
  );
}
