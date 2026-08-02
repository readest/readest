import clsx from 'clsx';
import React, { useState, useMemo, useEffect } from 'react';
import { marked } from 'marked';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  BookFormat,
  BooknoteGroup,
  HighlightColor,
  HighlightStyle,
  NoteExportConfig,
  NoteExportFormat,
} from '@/types/book';
import { buildAnnotationExport } from '@/services/annotation/providers/readest';
import { DEFAULT_NOTE_EXPORT_CONFIG } from '@/services/constants';
import { saveViewSettings } from '@/helpers/settings';
import {
  filterExportGroups,
  getHighlightColorHex,
  getHighlightColorLabel,
} from '@/app/reader/utils/annotatorUtil';
import { renderNoteTemplate, formatBlockQuote } from '@/utils/note';
import { getPublicCoverUrl } from '@/utils/cover';
import {
  AnnotationLinkType,
  buildAnnotationAppUrl,
  buildAnnotationUrl,
  buildAnnotationWebUrl,
} from '@/utils/deeplink';
import Dialog from '@/components/Dialog';

interface ExportMarkdownDialogProps {
  bookKey: string;
  isOpen: boolean;
  bookHash: string;
  bookMetaHash?: string;
  bookTitle: string;
  bookAuthor: string;
  bookFormat: BookFormat;
  // Carried in the JSON export so a re-downloaded copy of the book can pick
  // the reading position back up (#5400).
  progress?: [number, number];
  location?: string;
  booknoteGroups: { [href: string]: BooknoteGroup };
  onCancel: () => void;
  onExport: (
    content: string,
    format: NoteExportFormat,
    sharePosition?: { x: number; y: number; preferredEdge?: 'top' | 'bottom' | 'left' | 'right' },
  ) => void;
}

const ExportMarkdownDialog: React.FC<ExportMarkdownDialogProps> = ({
  bookKey,
  isOpen,
  bookHash,
  bookMetaHash,
  bookTitle,
  bookAuthor,
  bookFormat,
  progress,
  location,
  booknoteGroups,
  onCancel,
  onExport,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);

  const defaultTemplate = `{% if coverImageUrl %}![cover|300]({{ coverImageUrl }})

{% endif %}## {{ title }}
**${_('Author')}**: {{ author }}

**${_('Exported from Readest')}**: {{ exportDate | date('%Y-%m-%d') }}

---

### ${_('Highlights & Annotations')}

{% for chapter in chapters %}
#### {{ chapter.title }}
{% for annotation in chapter.annotations %}
{% if annotation.color == 'yellow' %}
- {{ annotation.text }}
{% elif annotation.color == 'red' %}
- ❗ {{ annotation.text }}
{% elif annotation.color == 'green' %}
- ✅ {{ annotation.text }}
{% elif annotation.color == 'blue' %}
- 💡 {{ annotation.text }}
{% elif annotation.color == 'violet' %}
- ✨ {{ annotation.text }}
{% else %}
- {{ annotation.text }}
{% endif %}
{% if annotation.note %}
**${_('Note:')}** {{ annotation.note }}
{% endif %}
*{% if annotation.link %}[${_('Page:')} {{ annotation.page }}]({{ annotation.link }}){% else %}${_('Page:')} {{ annotation.page }}{% endif %} · ${_('Time:')} {{ annotation.timestamp | date('%Y-%m-%d %H:%M') }}*
{% endfor %}

---
{% endfor %}`;

  const [exportConfig, setExportConfig] = useState<NoteExportConfig>(() => {
    const noteExportConfig = viewSettings?.noteExportConfig || DEFAULT_NOTE_EXPORT_CONFIG;
    return {
      ...noteExportConfig,
      // Configs persisted before link types existed fall back to the
      // platform-aware default (app in the native app, web on the web).
      linkType: noteExportConfig.linkType ?? DEFAULT_NOTE_EXPORT_CONFIG.linkType,
      customTemplate: noteExportConfig.customTemplate || defaultTemplate,
      // Configs persisted before color/style filtering existed have no
      // exclusion arrays; default to exporting everything.
      excludedColors: noteExportConfig.excludedColors ?? [],
      excludedStyles: noteExportConfig.excludedStyles ?? [],
      // Configs persisted before the cover option existed.
      includeCoverImage: noteExportConfig.includeCoverImage ?? false,
      // Configs persisted before the format select existed only recorded the
      // markdown/plain-text toggle.
      exportFormat:
        noteExportConfig.exportFormat ?? (noteExportConfig.exportAsPlainText ? 'text' : 'markdown'),
    };
  });

  const isJson = exportConfig.exportFormat === 'json';
  const isPlainText = exportConfig.exportFormat === 'text';

  const [showSource, setShowSource] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Resolving a cover URL may publish the local cover to public storage, so it
  // runs only when the export actually references one: the checkbox in simple
  // mode, the coverImageUrl variable in template mode.
  const wantsCoverImage = exportConfig.useCustomTemplate
    ? exportConfig.customTemplate.includes('coverImageUrl')
    : exportConfig.includeCoverImage;
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !wantsCoverImage || coverImageUrl) return;
    const book = getBookData(bookKey)?.book;
    if (!book) return;
    let cancelled = false;
    getPublicCoverUrl(book, appService).then((url) => {
      if (!cancelled) setCoverImageUrl(url ?? null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, wantsCoverImage, bookKey, appService]);

  useEffect(() => {
    const customTemplate = exportConfig.customTemplate;
    const newExportConfig = {
      ...exportConfig,
      customTemplate: customTemplate === defaultTemplate ? '' : customTemplate,
      // Mirror the format back onto the legacy flag so a downgrade still
      // lands on markdown or plain text rather than an unknown value.
      exportAsPlainText: exportConfig.exportFormat === 'text',
    };
    saveViewSettings(envConfig, bookKey, 'noteExportConfig', newExportConfig, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportConfig, envConfig, bookKey]);

  // Helper function to strip markdown formatting
  const stripMarkdown = (text: string): string => {
    return text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // Remove image embeds (cover)
      .replace(/^#{1,6}\s+/gm, '') // Remove headers
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.+?)\*/g, '$1') // Remove italic
      .replace(/^>\s+/gm, '') // Remove blockquotes
      .replace(/^---$/gm, '') // Remove horizontal rules
      .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
      .trim();
  };

  // Apply the color/style filter once; both the default formatter and the custom
  // template render the filtered groups, and the same metadata drives the filter UI.
  const {
    groups: filteredGroups,
    distinctColors,
    distinctStyles,
    applyColorFilter,
    applyStyleFilter,
  } = useMemo(
    () =>
      filterExportGroups(
        Object.values(booknoteGroups).sort((a, b) => a.id - b.id),
        {
          excludedColors: exportConfig.excludedColors,
          excludedStyles: exportConfig.excludedStyles,
        },
      ),
    [booknoteGroups, exportConfig.excludedColors, exportConfig.excludedStyles],
  );

  const filteredNotesCount = useMemo(
    () => filteredGroups.reduce((count, group) => count + group.booknotes.length, 0),
    [filteredGroups],
  );

  const toggleExcludedColor = (color: HighlightColor) => {
    setExportConfig((prev) => ({
      ...prev,
      excludedColors: prev.excludedColors.includes(color)
        ? prev.excludedColors.filter((c) => c !== color)
        : [...prev.excludedColors, color],
    }));
  };

  const toggleExcludedStyle = (style: HighlightStyle) => {
    setExportConfig((prev) => ({
      ...prev,
      excludedStyles: prev.excludedStyles.includes(style)
        ? prev.excludedStyles.filter((s) => s !== style)
        : [...prev.excludedStyles, style],
    }));
  };

  // Mirror HighlightOptions: user label, else translated default name, else the raw hex.
  const resolveColorLabel = (color: HighlightColor): string => {
    const userLabel = getHighlightColorLabel(settings, color);
    if (userLabel) return userLabel;
    if (!color.startsWith('#')) return _(color);
    return color;
  };

  // Generate markdown preview based on current format settings
  const markdownPreview = useMemo(() => {
    let output = '';

    if (exportConfig.exportFormat === 'json') {
      return JSON.stringify(
        buildAnnotationExport({
          book: {
            title: bookTitle,
            author: bookAuthor,
            hash: bookHash,
            metaHash: bookMetaHash,
            format: bookFormat,
          },
          groups: filteredGroups,
          progress,
          location,
          exportedAt: Date.now(),
        }),
        null,
        2,
      );
    }

    if (exportConfig.useCustomTemplate) {
      // Prepare data for template rendering
      const sortedGroups = filteredGroups;

      const templateData = {
        title: bookTitle,
        author: bookAuthor,
        exportDate: Date.now(),
        coverImageUrl: coverImageUrl ?? '',
        chapters: sortedGroups.map((group) => ({
          title: group.label || _('Untitled'),
          annotations: group.booknotes.map((note) => ({
            ...note,
            id: note.id,
            cfi: note.cfi,
            bookHash,
            link: buildAnnotationUrl(
              { bookHash, noteId: note.id, cfi: note.cfi },
              exportConfig.linkType,
            ),
            webLink: buildAnnotationWebUrl({ bookHash, noteId: note.id, cfi: note.cfi }),
            appLink: buildAnnotationAppUrl({ bookHash, noteId: note.id, cfi: note.cfi }),
            text: note.text || '',
            note: note.note || '',
            style: note.style,
            color: note.color,
            page: note.page,
            timestamp: note.updatedAt,
          })),
        })),
      };

      output = renderNoteTemplate(exportConfig.customTemplate, templateData);
    } else {
      // Default formatting (non-template mode)
      const sortedGroups = filteredGroups;

      const lines: string[] = [];

      // Add cover image (placed first, mirroring Readwise's own exports).
      // `|300` is Obsidian's image-width syntax; other renderers treat it as
      // alt text and ignore it.
      if (exportConfig.includeCoverImage && coverImageUrl) {
        lines.push(`![cover|300](${coverImageUrl})`);
        lines.push('');
      }

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
            lines.push(formatBlockQuote(note.text));
          }

          // Add note
          if (exportConfig.includeNotes && note.note) {
            lines.push('');
            lines.push(`**${_('Note')}**: ${note.note}`);
          }

          let pageStr = '';
          if (exportConfig.includePageNumber && note.page) {
            const pageText = _('Page: {{number}}', { number: note.page });
            if (bookHash && note.id) {
              const url = buildAnnotationUrl(
                { bookHash, noteId: note.id, cfi: note.cfi },
                exportConfig.linkType,
              );
              pageStr = `[${pageText}](${url})`;
            } else {
              pageStr = pageText;
            }
          }
          let timestampStr = '';
          if (exportConfig.includeTimestamp && note.updatedAt) {
            const timestamp = new Date(note.updatedAt).toLocaleString();
            timestampStr = `${_('Time:')} ${timestamp}`;
          }
          const infoParts = [pageStr, timestampStr].filter(Boolean);
          if (infoParts.length > 0) {
            lines.push('');
            lines.push(`*${infoParts.join(' · ')}*`);
          }

          lines.push(exportConfig.noteSeparator);
        }

        if (exportConfig.includeChapterSeparator) {
          lines.push('---');
          lines.push('');
        }
      }

      output = lines.join('\n');
    }

    // Strip markdown if plain text export is enabled
    if (isPlainText) {
      output = stripMarkdown(output);
    }

    return output;
  }, [
    exportConfig,
    isPlainText,
    filteredGroups,
    bookTitle,
    bookAuthor,
    bookHash,
    bookMetaHash,
    bookFormat,
    progress,
    location,
    coverImageUrl,
    _,
  ]);

  // Convert markdown to HTML for preview
  const htmlPreview = useMemo(() => {
    if (!markdownPreview || isJson) return '';
    const html = marked.parse(markdownPreview) as string;
    return (
      html
        .replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=')
        // The web app is cross-origin isolated (COEP: require-corp, see
        // middleware.ts) and R2 attaches no CORP header, so a plain <img> to
        // assets.readest.com is blocked. Requesting it with CORS satisfies
        // COEP: the bucket allowlists the app origins for GET.
        .replace(/<img /g, '<img crossorigin="anonymous" ')
    );
  }, [markdownPreview, isJson]);

  const handleToggle = (field: keyof NoteExportConfig) => {
    setExportConfig((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleExport = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Anchor the macOS / iPad share sheet to the Export button rect so
    // NSSharingServicePicker doesn't fall back to the WebView's top-left.
    // `preferredEdge: 'bottom'` maps to NSMinYEdge — in the flipped WKWebView
    // coord space that's the rect's top edge, so the popover appears above
    // the button regardless of whether there is room below it.
    const rect = e.currentTarget.getBoundingClientRect();
    const sharePosition = {
      x: rect.left + rect.width / 2,
      y: rect.top,
      preferredEdge: 'bottom' as const,
    };
    onExport(markdownPreview, exportConfig.exportFormat, sharePosition);
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
        {/* Export Format */}
        <div className='flex items-center justify-between gap-3'>
          <h3 className='font-bold'>{_('Format')}</h3>
          <select
            value={exportConfig.exportFormat}
            onChange={(e) =>
              setExportConfig((prev) => ({
                ...prev,
                exportFormat: e.target.value as NoteExportFormat,
              }))
            }
            className='select select-bordered select-sm eink-bordered'
          >
            <option value='markdown'>{_('Markdown')}</option>
            <option value='text'>{_('Plain Text')}</option>
            <option value='json'>{_('JSON (Readest)')}</option>
          </select>
        </div>

        {isJson && (
          <p className='text-base-content/70 text-xs'>
            {_('A machine-readable file that Readest can import back into any book.')}
          </p>
        )}

        {/* Format Options */}
        {!isJson && (
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
                  checked={exportConfig.includeCoverImage}
                  onChange={() => handleToggle('includeCoverImage')}
                  className='checkbox checkbox-sm'
                  disabled={exportConfig.useCustomTemplate}
                />
                <span className='text-sm'>{_('Cover Image')}</span>
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
                  checked={exportConfig.includePageNumber}
                  onChange={() => handleToggle('includePageNumber')}
                  className='checkbox checkbox-sm'
                  disabled={exportConfig.useCustomTemplate}
                />
                <span className='text-sm'>{_('Page Number')}</span>
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

            <div className='flex items-center justify-between gap-3'>
              <span className='text-sm'>{_('Annotation Link')}</span>
              <select
                value={exportConfig.linkType}
                onChange={(e) =>
                  setExportConfig((prev) => ({
                    ...prev,
                    linkType: e.target.value as AnnotationLinkType,
                  }))
                }
                className='select select-bordered select-sm eink-bordered'
              >
                <option value='app'>{_('App Link')}</option>
                <option value='web'>{_('Web Link')}</option>
              </select>
            </div>
          </div>
        )}

        {/* Filter by color / style */}
        {(applyColorFilter || applyStyleFilter) && (
          <div className='space-y-3'>
            <h3 className='font-bold'>{_('Filter Annotations')}</h3>

            {applyColorFilter && (
              <div className='space-y-2'>
                <span className='text-sm font-medium'>{_('Colors')}</span>
                <div className='flex flex-wrap gap-x-6 gap-y-2'>
                  {distinctColors.map((color) => {
                    const included = !exportConfig.excludedColors.includes(color);
                    const hex = getHighlightColorHex(settings, color) ?? color;
                    const label = resolveColorLabel(color);
                    return (
                      <label key={color} className='flex cursor-pointer items-center gap-2'>
                        <input
                          type='checkbox'
                          checked={included}
                          onChange={() => toggleExcludedColor(color)}
                          className='checkbox checkbox-sm'
                        />
                        <span
                          className='border-base-content/20 h-3 w-3 shrink-0 rounded-full border'
                          style={{ backgroundColor: hex }}
                        />
                        <span className='text-sm'>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {applyStyleFilter && (
              <div className='space-y-2'>
                <span className='text-sm font-medium'>{_('Styles')}</span>
                <div className='flex flex-wrap gap-x-6 gap-y-2'>
                  {distinctStyles.map((style) => {
                    const included = !exportConfig.excludedStyles.includes(style);
                    return (
                      <label key={style} className='flex cursor-pointer items-center gap-2'>
                        <input
                          type='checkbox'
                          checked={included}
                          onChange={() => toggleExcludedStyle(style)}
                          className='checkbox checkbox-sm'
                        />
                        <span className='text-sm'>{_(style)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Advanced Options */}
        {!isJson && (
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
                      <div className='flex items-center justify-between'>
                        <label className='text-sm font-medium'>{_('Export Template')}</label>
                        <button
                          onClick={() =>
                            setExportConfig({ ...exportConfig, customTemplate: defaultTemplate })
                          }
                          className='text-sm text-blue-500 hover:underline'
                        >
                          {_('Reset Template')}
                        </button>
                      </div>
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
                            <code className='bg-base-300 rounded px-1'>coverImageUrl</code> -{' '}
                            {_('Public cover image URL (empty if unavailable)')}
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
                            <code className='bg-base-300 rounded px-1'>annotation.style</code> -{' '}
                            {_('Annotation style')}: underline | highlight | squiggly
                          </li>
                          <li className='ml-8'>
                            <code className='bg-base-300 rounded px-1'>annotation.color</code> -{' '}
                            {_('Annotation color')}: yellow | red | green | blue | violet
                          </li>
                          <li className='ml-8'>
                            <code className='bg-base-300 rounded px-1'>annotation.page</code> -{' '}
                            {_('Annotation page number')}
                          </li>
                          <li className='ml-8'>
                            <code className='bg-base-300 rounded px-1'>annotation.timestamp</code> -{' '}
                            {_('Annotation time')}
                          </li>
                          <li className='ml-8'>
                            <code className='bg-base-300 rounded px-1'>annotation.link</code> -{' '}
                            {_('Annotation link (follows the selected Link Type)')}
                          </li>
                          <li className='ml-8'>
                            <code className='bg-base-300 rounded px-1'>annotation.appLink</code> -{' '}
                            {_('App deeplink (readest://)')}
                          </li>
                          <li className='ml-8'>
                            <code className='bg-base-300 rounded px-1'>annotation.webLink</code> -{' '}
                            {_('Universal web link (https://)')}
                          </li>
                        </ul>
                      </div>
                      <div>
                        <p className='mb-2 font-bold'>{_('Available Formatters:')}</p>
                        <ul className='space-y-1 font-mono'>
                          <li>
                            <code className='bg-base-300 rounded px-1'>date</code> /{' '}
                            <code className='bg-base-300 rounded px-1'>{"date('%Y-%m-%d')"}</code> -{' '}
                            {_('Format date')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>blockquote</code> -{' '}
                            {_('Markdown block quote (> per line)')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>nl2br</code> -{' '}
                            {_('Newlines to <br>')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>upper</code> /{' '}
                            <code className='bg-base-300 rounded px-1'>lower</code> /{' '}
                            <code className='bg-base-300 rounded px-1'>capitalize</code> /{' '}
                            <code className='bg-base-300 rounded px-1'>title</code> -{' '}
                            {_('Change case')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>trim</code> -{' '}
                            {_('Trim whitespace')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>truncate(n)</code> -{' '}
                            {_('Truncate to n characters')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>{"replace('a', 'b')"}</code>{' '}
                            - {_('Replace text')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>default(val)</code> -{' '}
                            {_('Fallback value')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>length</code> -{' '}
                            {_('Get length')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>first</code> /{' '}
                            <code className='bg-base-300 rounded px-1'>last</code> -{' '}
                            {_('First/last element')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>{"join(', ')"}</code> -{' '}
                            {_('Join array')}
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
                            <code className='bg-base-300 rounded px-1'>%d</code> -{' '}
                            {_('Day (01-31)')}
                          </li>
                          <li>
                            <code className='bg-base-300 rounded px-1'>%H</code> -{' '}
                            {_('Hour (00-23)')}
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
        )}

        {/* Preview */}
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <h3 className='font-bold'>{_('Preview')}</h3>
            {!isJson && (
              <label className='flex cursor-pointer items-center gap-2'>
                <input
                  type='checkbox'
                  checked={showSource}
                  onChange={() => setShowSource(!showSource)}
                  className='checkbox checkbox-sm'
                />
                <span className='text-sm'>{_('Show Source')}</span>
              </label>
            )}
          </div>
          {isJson || showSource || isPlainText ? (
            <div
              className={clsx(
                'bg-base-200 max-h-[40vh] overflow-y-auto rounded-lg p-4 text-xs',
                'select-text whitespace-pre-wrap break-words',
                isJson || showSource ? 'font-mono' : 'font-sans',
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
        <div className='mt-4 flex items-center justify-end'>
          <div className='flex gap-4'>
            <button onClick={onCancel} className='btn btn-ghost btn-sm'>
              {_('Cancel')}
            </button>
            <button
              onClick={handleExport}
              className='btn btn-primary btn-sm'
              disabled={filteredNotesCount === 0}
            >
              {_('Export')}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};

export default ExportMarkdownDialog;
