import clsx from 'clsx';
import React, { useState, useMemo, useEffect } from 'react';
import { marked } from 'marked';
import { BookNote, BooknoteGroup, NoteExportConfig } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import Dialog from '@/components/Dialog';
import { useReaderStore } from '@/store/readerStore';
import { DEFAULT_NOTE_EXPORT_CONFIG } from '@/services/constants';
import { saveViewSettings } from '@/helpers/settings';
import { useEnv } from '@/context/EnvContext';

interface ExportMarkdownDialogProps {
  bookKey: string;
  isOpen: boolean;
  bookTitle: string;
  bookAuthor: string;
  booknotes: BookNote[];
  booknoteGroups: { [href: string]: BooknoteGroup };
  onCancel: () => void;
  onExport: (markdown: string) => void;
}

type TemplateData = {
  title: string;
  author: string;
  exportDate: string;
  chapters: {
    title: string;
    annotations: {
      text: string;
      note?: string;
      timestamp?: number;
    }[];
  }[];
};

type TemplateVariable = { [key: string]: number | string | TemplateVariable | TemplateVariable[] };

const renderTemplate = (template: string, data: TemplateData): string => {
  const applyFilter = (
    value: TemplateVariable,
    filter: string,
    filterArg?: string,
  ): TemplateVariable | string => {
    if (filter === 'date') {
      if (typeof value === 'number') {
        const date = new Date(value);
        if (filterArg) {
          const format = filterArg;
          return format
            .replace('%Y', date.getFullYear().toString())
            .replace('%m', String(date.getMonth() + 1).padStart(2, '0'))
            .replace('%d', String(date.getDate()).padStart(2, '0'))
            .replace('%H', String(date.getHours()).padStart(2, '0'))
            .replace('%M', String(date.getMinutes()).padStart(2, '0'))
            .replace('%S', String(date.getSeconds()).padStart(2, '0'));
        }
        return date.toLocaleString();
      }
      return value;
    }
    return value;
  };

  const getValue = (path: string, context: TemplateData) => {
    const keys = path.trim().split('.');
    let value = context as TemplateVariable;
    for (const key of keys) {
      value = value?.[key] as TemplateVariable;
    }
    return value;
  };

  let result = template;

  // Process {% for %} loops - find first occurrence and recurse
  const forMatch = result.match(/\{%\s*for\s+(\w+)\s+in\s+(\w+(?:\.\w+)*)\s*%\}/);
  if (forMatch) {
    const itemName = forMatch[1]!;
    const collectionPath = forMatch[2]!;

    // Find matching {% endfor %} by counting nesting
    let depth = 0;
    let endPos = -1;
    const startPos = forMatch.index! + forMatch[0].length;

    for (let i = startPos; i < result.length; i++) {
      const remaining = result.slice(i);
      if (remaining.startsWith('{% for ')) {
        depth++;
        i += 6; // skip past "{% for"
      } else if (remaining.startsWith('{% endfor %}')) {
        if (depth === 0) {
          endPos = i;
          break;
        }
        depth--;
        i += 11; // skip past "{% endfor %}"
      }
    }

    if (endPos !== -1) {
      const beforeLoop = result.slice(0, forMatch.index);
      const loopContent = result.slice(startPos, endPos);
      const afterLoop = result.slice(endPos + 13); // 13 = length of "{% endfor %}"

      const collection = getValue(collectionPath, data);

      if (Array.isArray(collection)) {
        const renderedItems = collection
          .map((item) => {
            const loopData = { ...data, [itemName]: item };
            return renderTemplate(loopContent, loopData);
          })
          .join('');

        result = beforeLoop + renderedItems + afterLoop;
        return renderTemplate(result, data);
      } else {
        // Collection not found or not an array, remove the loop
        result = beforeLoop + afterLoop;
        return renderTemplate(result, data);
      }
    }
  }

  // Process {% if condition %}...{% endif %}
  result = result.replace(
    /\{%\s*if\s+([^%]+?)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g,
    (_match, condition, content) => {
      const value = getValue(condition, data);
      return value ? renderTemplate(content, data) : '';
    },
  );

  // Replace {{ variable }}, {{ variable | filter }}, and {{ variable | filter('arg') }}
  result = result.replace(
    /\{\{\s*([^}|]+?)(?:\s*\|\s*(\w+)(?:\s*\((['"]?)([^)'"]*)\3\))?)?\s*\}\}/g,
    (_match, path, filter, _quote, filterArg) => {
      const value = getValue(path, data);
      if (value === undefined || value === null) return '';
      if (filter) {
        return applyFilter(value, filter, filterArg) as string;
      }
      return String(value);
    },
  );

  return result;
};

const ExportMarkdownDialog: React.FC<ExportMarkdownDialogProps> = ({
  bookKey,
  isOpen,
  bookTitle,
  bookAuthor,
  booknotes,
  booknoteGroups,
  onCancel,
  onExport,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const defaultTemplate = `## {{ title }}
**${_('Author')}**: {{ author }}

**${_('Exported from Readest')}**: {{ exportDate }}

---

### ${_('Highlights & Annotations')}

{% for chapter in chapters %}
#### {{ chapter.title }}
{% for annotation in chapter.annotations %}
> {{ annotation.text }}
{% if annotation.note %}
**${_('Note:')}** {{ annotation.note }}
{% endif %}
*${_('Time:')} {{ annotation.timestamp | date('%Y-%m-%d %H:%M') }}*
{% endfor %}

---
{% endfor %}`;

  const [exportConfig, setExportConfig] = useState<NoteExportConfig>(() => {
    const noteExportConfig = viewSettings?.noteExportConfig || DEFAULT_NOTE_EXPORT_CONFIG;
    if (!noteExportConfig.customTemplate) {
      return {
        ...noteExportConfig,
        customTemplate: defaultTemplate,
      };
    }
    return noteExportConfig;
  });

  const [showSource, setShowSource] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const customTemplate = exportConfig.customTemplate;
    const newExportConfig = {
      ...exportConfig,
      customTemplate: customTemplate === defaultTemplate ? '' : customTemplate,
    };
    saveViewSettings(envConfig, bookKey, 'noteExportConfig', newExportConfig, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportConfig, envConfig, bookKey]);

  // Generate markdown preview based on current format settings
  const markdownPreview = useMemo(() => {
    if (exportConfig.useCustomTemplate) {
      // Prepare data for template rendering
      const sortedGroups = Object.values(booknoteGroups).sort((a, b) => a.id - b.id);

      const templateData = {
        title: bookTitle,
        author: bookAuthor,
        exportDate: new Date().toISOString().slice(0, 10),
        chapters: sortedGroups.map((group) => ({
          title: group.label || _('Untitled'),
          annotations: group.booknotes.map((note) => ({
            text: note.text || '',
            note: note.note || '',
            style: note.style,
            color: note.color,
            timestamp: note.updatedAt,
          })),
        })),
      };

      return renderTemplate(exportConfig.customTemplate, templateData);
    }

    // Default formatting (non-template mode)
    const sortedGroups = Object.values(booknoteGroups).sort((a, b) => a.id - b.id);

    const lines: string[] = [];

    // Add title
    if (exportConfig.includeTitle) {
      lines.push(`# ${bookTitle}`);
    }

    // Add author
    if (exportConfig.includeAuthor && bookAuthor) {
      lines.push(`**${_('Author')}**: ${bookAuthor}`);
      lines.push('');
    }

    // Add export date
    if (exportConfig.includeDate) {
      lines.push(`**${_('Exported from Readest')}**: ${new Date().toISOString().slice(0, 10)}`);
      lines.push('');
    }

    if (exportConfig.includeTitle || exportConfig.includeAuthor || exportConfig.includeDate) {
      lines.push('---');
      lines.push('');
    }

    lines.push(`## ${_('Highlights & Annotations')}`);
    lines.push('');

    for (const group of sortedGroups) {
      // Add chapter title
      if (exportConfig.includeChapterTitles) {
        const chapterTitle = group.label || _('Untitled');
        lines.push(`### ${chapterTitle}`);
      }

      for (const note of group.booknotes) {
        // Add quote
        if (exportConfig.includeQuotes && note.text) {
          lines.push(`> ${note.text}`);
        }

        // Add note
        if (exportConfig.includeNotes && note.note) {
          lines.push('');
          lines.push(`**${_('Note')}**:: ${note.note}`);
        }

        // Add timestamp
        if (exportConfig.includeTimestamp && note.updatedAt) {
          const timestamp = new Date(note.updatedAt).toLocaleString();
          lines.push('');
          lines.push(`*${_('Time:')} ${timestamp}*`);
        }

        lines.push(exportConfig.noteSeparator);
      }

      if (exportConfig.includeChapterSeparator) {
        lines.push('---');
        lines.push('');
      }
    }

    return lines.join('\n');
  }, [exportConfig, booknoteGroups, bookTitle, bookAuthor, _]);

  // Convert markdown to HTML for preview
  const htmlPreview = useMemo(() => {
    if (!markdownPreview) return '';
    return marked.parse(markdownPreview);
  }, [markdownPreview]);

  const handleToggle = (field: keyof NoteExportConfig) => {
    setExportConfig((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleExport = () => {
    onExport(markdownPreview);
  };

  return (
    <Dialog
      isOpen={isOpen}
      title={_('Export Annotations')}
      onClose={onCancel}
      boxClassName='sm:!w-[75%] sm:h-auto sm:!max-h-[90vh] sm:!max-w-5xl'
      contentClassName='sm:!px-8 sm:!py-2'
    >
      <div className='flex flex-col gap-4'>
        {/* Format Options */}
        <div className='space-y-3'>
          <h3 className='font-bold'>{_('Format Options')}</h3>

          <div
            className={clsx(
              'grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3',
              exportConfig.useCustomTemplate && 'pointer-events-none opacity-50',
            )}
          >
            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeTitle}
                onChange={() => handleToggle('includeTitle')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Title')}</span>
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeAuthor}
                onChange={() => handleToggle('includeAuthor')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Author')}</span>
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeDate}
                onChange={() => handleToggle('includeDate')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Export Date')}</span>
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeChapterTitles}
                onChange={() => handleToggle('includeChapterTitles')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Chapter Titles')}</span>
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeChapterSeparator}
                onChange={() => handleToggle('includeChapterSeparator')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Chapter Separator')}</span>
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeQuotes}
                onChange={() => handleToggle('includeQuotes')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Highlights')}</span>
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeNotes}
                onChange={() => handleToggle('includeNotes')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Notes')}</span>
            </label>

            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={exportConfig.includeTimestamp}
                onChange={() => handleToggle('includeTimestamp')}
                className='checkbox checkbox-sm'
                disabled={exportConfig.useCustomTemplate}
              />
              <span className='text-sm'>{_('Note Date')}</span>
            </label>
          </div>
        </div>

        {/* Advanced Options */}
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <h3 className='font-bold'>{_('Advanced')}</h3>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className='text-sm text-blue-500 hover:underline'
            >
              {showAdvanced ? _('Hide') : _('Show')}
            </button>
          </div>

          {showAdvanced && (
            <div className='space-y-3'>
              <label className='flex cursor-pointer items-center gap-2'>
                <input
                  type='checkbox'
                  checked={exportConfig.useCustomTemplate}
                  onChange={() => handleToggle('useCustomTemplate')}
                  className='checkbox checkbox-sm'
                />
                <span className='text-sm font-medium'>{_('Use Custom Template')}</span>
              </label>

              {exportConfig.useCustomTemplate && (
                <>
                  <div className='space-y-2'>
                    <label className='text-sm font-medium'>{_('Export Template')}</label>
                    <textarea
                      value={exportConfig.customTemplate}
                      onChange={(e) =>
                        setExportConfig({ ...exportConfig, customTemplate: e.target.value })
                      }
                      className='textarea textarea-bordered w-full font-mono text-xs'
                      rows={12}
                      placeholder={defaultTemplate}
                    />
                  </div>

                  <div className='bg-base-200 space-y-3 rounded-lg p-3 text-xs'>
                    <div>
                      <p className='mb-2 font-bold'>{_('Template Syntax:')}</p>
                      <ul className='space-y-1 font-mono'>
                        <li>
                          <code className='bg-base-300 rounded px-1'>{'{{ variable }}'}</code> -{' '}
                          {_('Insert value')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>
                            {'{{ variable | date }}'}
                          </code>{' '}
                          - {_('Format date (locale)')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>
                            {"{{ variable | date('%Y-%m-%d') }}"}
                          </code>{' '}
                          - {_('Format date (custom)')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>
                            {'{% if variable %}...{% endif %}'}
                          </code>{' '}
                          - {_('Conditional')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>
                            {'{% for item in list %}...{% endfor %}'}
                          </code>{' '}
                          - {_('Loop')}
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className='mb-2 font-bold'>{_('Available Variables:')}</p>
                      <ul className='space-y-1'>
                        <li>
                          <code className='bg-base-300 rounded px-1'>title</code> -{' '}
                          {_('Book title')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>author</code> -{' '}
                          {_('Book author')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>exportDate</code> -{' '}
                          {_('Export date')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>chapters</code> -{' '}
                          {_('Array of chapters')}
                        </li>
                        <li className='ml-4'>
                          <code className='bg-base-300 rounded px-1'>chapter.title</code> -{' '}
                          {_('Chapter title')}
                        </li>
                        <li className='ml-4'>
                          <code className='bg-base-300 rounded px-1'>chapter.annotations</code> -{' '}
                          {_('Array of annotations')}
                        </li>
                        <li className='ml-8'>
                          <code className='bg-base-300 rounded px-1'>annotation.text</code> -{' '}
                          {_('Highlighted text')}
                        </li>
                        <li className='ml-8'>
                          <code className='bg-base-300 rounded px-1'>annotation.note</code> -{' '}
                          {_('Annotation note')}
                        </li>
                        <li className='ml-8'>
                          <code className='bg-base-300 rounded px-1'>annotation.timestamp</code> -{' '}
                          {_('Update time')}
                        </li>
                      </ul>
                    </div>
                    <div>
                      <p className='mb-2 font-bold'>{_('Date Format Tokens:')}</p>
                      <ul className='space-y-1 font-mono'>
                        <li>
                          <code className='bg-base-300 rounded px-1'>%Y</code> -{' '}
                          {_('Year (4 digits)')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>%m</code> -{' '}
                          {_('Month (01-12)')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>%d</code> - {_('Day (01-31)')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>%H</code> - {_('Hour (00-23)')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>%M</code> -{' '}
                          {_('Minute (00-59)')}
                        </li>
                        <li>
                          <code className='bg-base-300 rounded px-1'>%S</code> -{' '}
                          {_('Second (00-59)')}
                        </li>
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <h3 className='font-bold'>{_('Preview')}</h3>
            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={showSource}
                onChange={() => setShowSource(!showSource)}
                className='checkbox checkbox-sm'
              />
              <span className='text-sm'>{_('Show Source')}</span>
            </label>
          </div>
          {showSource ? (
            <div
              className={clsx(
                'bg-base-200 max-h-[40vh] overflow-y-auto rounded-lg p-4 font-mono text-xs',
                'select-text whitespace-pre-wrap break-words',
              )}
            >
              {markdownPreview || _('No content to preview')}
            </div>
          ) : (
            <div
              className={clsx(
                'bg-base-200 prose prose-sm max-w-none overflow-y-auto rounded-lg p-4',
                'max-h-[40vh] select-text break-words',
              )}
              dangerouslySetInnerHTML={{
                __html:
                  htmlPreview ||
                  `<p class="text-base-content/50">${_('No content to preview')}</p>`,
              }}
            />
          )}
        </div>

        {/* Footer Actions */}
        <div className='mt-4 flex justify-end gap-4'>
          <button onClick={onCancel} className='btn btn-ghost btn-sm'>
            {_('Cancel')}
          </button>
          <button
            onClick={handleExport}
            className='btn btn-primary btn-sm'
            disabled={booknotes.length === 0}
          >
            {_('Export')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default ExportMarkdownDialog;
