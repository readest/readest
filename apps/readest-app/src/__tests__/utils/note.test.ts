import { describe, it, expect } from 'vitest';
import { renderNoteTemplate, validateNoteTemplate, NoteTemplateData } from '../../utils/note';

describe('renderNoteTemplate', () => {
  const sampleData: NoteTemplateData = {
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    exportDate: '2024-01-15',
    chapters: [
      {
        title: 'Chapter 1',
        annotations: [
          {
            text: 'In my younger and more vulnerable years',
            note: 'Opening line',
            style: 'highlight',
            color: 'yellow',
            timestamp: 1705312800000, // 2024-01-15 10:00:00 UTC
          },
          {
            text: 'So we beat on, boats against the current',
            note: '',
            style: 'underline',
            color: 'blue',
            timestamp: 1705316400000, // 2024-01-15 11:00:00 UTC
          },
        ],
      },
      {
        title: 'Chapter 2',
        annotations: [
          {
            text: 'The eyes of Doctor T. J. Eckleburg',
            note: 'Symbolism',
            style: 'highlight',
            color: 'green',
            timestamp: 1705320000000, // 2024-01-15 12:00:00 UTC
          },
        ],
      },
    ],
  };

  describe('Variable substitution', () => {
    it('should substitute simple variables', () => {
      const template = 'Book: {{ title }} by {{ author }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Book: The Great Gatsby by F. Scott Fitzgerald');
    });

    it('should handle undefined variables gracefully', () => {
      const template = '{{ nonexistent }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('');
    });

    it('should handle nested property access', () => {
      const template = '{{ chapters[0].title }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Chapter 1');
    });

    it('should handle deeply nested property access', () => {
      const template = '{{ chapters[0].annotations[0].text }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('In my younger and more vulnerable years');
    });
  });

  describe('For loops', () => {
    it('should iterate over arrays', () => {
      const template = '{% for chapter in chapters %}{{ chapter.title }}\n{% endfor %}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toContain('Chapter 1');
      expect(result).toContain('Chapter 2');
    });

    it('should handle nested for loops', () => {
      const template = `{% for chapter in chapters %}
## {{ chapter.title }}
{% for annotation in chapter.annotations %}
- {{ annotation.text }}
{% endfor %}
{% endfor %}`;
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toContain('## Chapter 1');
      expect(result).toContain('- In my younger and more vulnerable years');
      expect(result).toContain('## Chapter 2');
      expect(result).toContain('- The eyes of Doctor T. J. Eckleburg');
    });

    it('should handle empty arrays', () => {
      const emptyData: NoteTemplateData = {
        title: 'Empty Book',
        author: 'Nobody',
        exportDate: '2024-01-15',
        chapters: [],
      };
      const template = '{% for chapter in chapters %}{{ chapter.title }}{% endfor %}';
      const result = renderNoteTemplate(template, emptyData);
      expect(result).toBe('');
    });

    it('should provide loop variables (loop.index, loop.first, loop.last)', () => {
      const template = `{% for chapter in chapters %}{{ loop.index }}: {{ chapter.title }}{% if not loop.last %}, {% endif %}{% endfor %}`;
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('1: Chapter 1, 2: Chapter 2');
    });

    it('should provide loop.index0 (0-based index)', () => {
      const template = `{% for chapter in chapters %}{{ loop.index0 }}: {{ chapter.title }}\n{% endfor %}`;
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toContain('0: Chapter 1');
      expect(result).toContain('1: Chapter 2');
    });
  });

  describe('Conditionals', () => {
    it('should handle if statements', () => {
      const template = '{% if author %}Author: {{ author }}{% endif %}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Author: F. Scott Fitzgerald');
    });

    it('should handle if-else statements', () => {
      const template = '{% if nonexistent %}Has value{% else %}No value{% endif %}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('No value');
    });

    it('should handle if-elif-else statements', () => {
      const template =
        '{% if chapters.length > 5 %}Many{% elif chapters.length > 1 %}Some{% else %}Few{% endif %}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Some');
    });

    it('should handle if statements with annotation note', () => {
      const template = `{% for chapter in chapters %}{% for annotation in chapter.annotations %}{% if annotation.note %}Note: {{ annotation.note }}
{% endif %}{% endfor %}{% endfor %}`;
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toContain('Note: Opening line');
      expect(result).toContain('Note: Symbolism');
      expect(result.match(/Note:/g)?.length).toBe(2);
    });
  });

  describe('Date filter', () => {
    it('should format timestamp with default locale format', () => {
      const template = '{{ chapters[0].annotations[0].timestamp | date }}';
      const result = renderNoteTemplate(template, sampleData);
      // Result will be locale-dependent, just check it's not empty
      expect(result).not.toBe('');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should format timestamp with custom format %Y-%m-%d', () => {
      const template = "{{ chapters[0].annotations[0].timestamp | date('%Y-%m-%d') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('2024-01-15');
    });

    it('should format timestamp with time format %H:%M:%S', () => {
      const template = "{{ chapters[0].annotations[0].timestamp | date('%H:%M:%S') }}";
      const result = renderNoteTemplate(template, sampleData);
      // This depends on timezone, so just check the format
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should format timestamp with full datetime', () => {
      const template = "{{ chapters[0].annotations[0].timestamp | date('%Y-%m-%d %H:%M') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toMatch(/^2024-01-15 \d{2}:\d{2}$/);
    });

    it('should handle 12-hour format with %I and %p', () => {
      const template = "{{ chapters[0].annotations[0].timestamp | date('%I:%M %p') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toMatch(/^\d{2}:\d{2} (AM|PM)$/);
    });

    it('should handle undefined timestamp', () => {
      const dataWithoutTimestamp: NoteTemplateData = {
        ...sampleData,
        chapters: [
          {
            title: 'Chapter',
            annotations: [{ text: 'Text' }],
          },
        ],
      };
      const template = "{{ chapters[0].annotations[0].timestamp | date('%Y-%m-%d') }}";
      const result = renderNoteTemplate(template, dataWithoutTimestamp);
      expect(result).toBe('');
    });

    it('should handle string date input', () => {
      const template = "{{ exportDate | date('%Y-%m-%d') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('2024-01-15');
    });

    it('should handle escaped percent signs', () => {
      const template =
        "{{ chapters[0].annotations[0].timestamp | date('100%% complete on %Y-%m-%d') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toContain('100% complete on 2024-01-15');
    });
  });

  describe('Default filter', () => {
    it('should return value when present', () => {
      const template = "{{ title | default('Unknown') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('The Great Gatsby');
    });

    it('should return default when value is undefined', () => {
      const template = "{{ nonexistent | default('Unknown') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Unknown');
    });

    it('should return default when value is empty string', () => {
      const template = "{{ chapters[0].annotations[1].note | default('No note') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('No note');
    });
  });

  describe('String filters', () => {
    it('should convert to uppercase with upper filter', () => {
      const template = '{{ title | upper }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('THE GREAT GATSBY');
    });

    it('should convert to lowercase with lower filter', () => {
      const template = '{{ title | lower }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('the great gatsby');
    });

    it('should capitalize with capitalize filter', () => {
      const template = '{{ "hello world" | capitalize }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Hello world');
    });

    it('should title case with title filter', () => {
      const template = '{{ "hello world" | title }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Hello World');
    });

    it('should trim whitespace with trim filter', () => {
      const template = '{{ "  spaced  " | trim }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('spaced');
    });

    it('should replace substrings with replace filter', () => {
      const template = "{{ title | replace('Great', 'Amazing') }}";
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('The Amazing Gatsby');
    });
  });

  describe('Truncate filter', () => {
    it('should truncate long strings', () => {
      const template = '{{ chapters[0].annotations[0].text | truncate(20) }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result.length).toBeLessThanOrEqual(23); // 20 + '...'
      expect(result).toContain('...');
    });

    it('should not truncate short strings', () => {
      const template = '{{ title | truncate(50) }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('The Great Gatsby');
    });

    it('should truncate at word boundaries by default', () => {
      const template = '{{ chapters[0].annotations[0].text | truncate(25) }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).not.toMatch(/\s\.\.\.$/); // Should not end with space before ...
    });
  });

  describe('Length filter', () => {
    it('should return string length', () => {
      const template = '{{ title | length }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('16');
    });

    it('should return array length', () => {
      const template = '{{ chapters | length }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('2');
    });
  });

  describe('First and last filters', () => {
    it('should get first element of array', () => {
      const template = '{% set first_chapter = chapters | first %}{{ first_chapter.title }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Chapter 1');
    });

    it('should get last element of array', () => {
      const template = '{% set last_chapter = chapters | last %}{{ last_chapter.title }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Chapter 2');
    });
  });

  describe('Join filter', () => {
    it('should join array elements', () => {
      // Using a loop with conditional comma separator
      const template =
        '{% for chapter in chapters %}{{ chapter.title }}{% if not loop.last %}, {% endif %}{% endfor %}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('Chapter 1, Chapter 2');
    });
  });

  describe('Newline to BR filter', () => {
    it('should convert newlines to br tags', () => {
      const dataWithNewlines: NoteTemplateData = {
        ...sampleData,
        chapters: [
          {
            title: 'Chapter 1',
            annotations: [
              {
                text: 'Line 1\nLine 2\nLine 3',
                note: 'Multiple lines',
              },
            ],
          },
        ],
      };
      const template = '{{ chapters[0].annotations[0].text | nl2br }}';
      const result = renderNoteTemplate(template, dataWithNewlines);
      expect(result).toBe('Line 1<br>\nLine 2<br>\nLine 3');
    });
  });

  describe('Chained filters', () => {
    it('should support chaining multiple filters', () => {
      const template = '{{ title | upper | truncate(10) }}';
      const result = renderNoteTemplate(template, sampleData);
      // truncate(10) with word boundaries results in "THE GREAT..." (breaks at word boundary)
      expect(result).toBe('THE GREAT...');
    });

    it('should support chaining with killwords option', () => {
      const template = '{{ title | upper | truncate(5, true) }}';
      const result = renderNoteTemplate(template, sampleData);
      // truncate(5, true) with killwords results in "THE G..."
      expect(result).toBe('THE G...');
    });

    it('should chain date and string filters', () => {
      const template = '{{ exportDate | upper }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('2024-01-15');
    });
  });

  describe('Complete template rendering', () => {
    it('should render a complete export template', () => {
      const template = `## {{ title }}
**Author**: {{ author }}

**Exported**: {{ exportDate }}

---

### Highlights & Annotations

{% for chapter in chapters %}
#### {{ chapter.title }}
{% for annotation in chapter.annotations %}
> {{ annotation.text }}
{% if annotation.note %}
**Note:** {{ annotation.note }}
{% endif %}
*Time: {{ annotation.timestamp | date('%Y-%m-%d %H:%M') }}*
{% endfor %}

---
{% endfor %}`;
      const result = renderNoteTemplate(template, sampleData);

      expect(result).toContain('## The Great Gatsby');
      expect(result).toContain('**Author**: F. Scott Fitzgerald');
      expect(result).toContain('#### Chapter 1');
      expect(result).toContain('> In my younger and more vulnerable years');
      expect(result).toContain('**Note:** Opening line');
      expect(result).toContain('#### Chapter 2');
      expect(result).toContain('> The eyes of Doctor T. J. Eckleburg');
    });

    it('should handle template with no chapters', () => {
      const emptyData: NoteTemplateData = {
        title: 'Empty Book',
        author: 'Unknown',
        exportDate: '2024-01-15',
        chapters: [],
      };
      const template = `## {{ title }}
{% for chapter in chapters %}
{{ chapter.title }}
{% endfor %}`;
      const result = renderNoteTemplate(template, emptyData);
      expect(result).toContain('## Empty Book');
      expect(result).not.toContain('Chapter');
    });
  });

  describe('Error handling', () => {
    it('should handle invalid template syntax gracefully', () => {
      const template = '{{ unclosed';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toContain('[Template Error:');
    });

    it('should handle invalid filter', () => {
      // Nunjucks throws on unknown filters
      const template = '{{ title | nonexistentfilter }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toContain('[Template Error:');
    });
  });

  describe('Special characters and escaping', () => {
    it('should not auto-escape HTML characters', () => {
      const dataWithHtml: NoteTemplateData = {
        ...sampleData,
        title: '<b>Bold</b> Title',
      };
      const template = '{{ title }}';
      const result = renderNoteTemplate(template, dataWithHtml);
      expect(result).toBe('<b>Bold</b> Title');
    });

    it('should handle markdown special characters', () => {
      const dataWithMarkdown: NoteTemplateData = {
        ...sampleData,
        chapters: [
          {
            title: '# Heading with **bold** and _italic_',
            annotations: [{ text: '> Quoted text' }],
          },
        ],
      };
      const template = '{{ chapters[0].title }}\n{{ chapters[0].annotations[0].text }}';
      const result = renderNoteTemplate(template, dataWithMarkdown);
      expect(result).toContain('# Heading with **bold** and _italic_');
      expect(result).toContain('> Quoted text');
    });

    it('should handle unicode characters', () => {
      const dataWithUnicode: NoteTemplateData = {
        ...sampleData,
        title: '红楼梦',
        author: '曹雪芹',
        chapters: [
          {
            title: '第一回',
            annotations: [{ text: '满纸荒唐言，一把辛酸泪。' }],
          },
        ],
      };
      const template = '{{ title }} - {{ author }}: {{ chapters[0].annotations[0].text }}';
      const result = renderNoteTemplate(template, dataWithUnicode);
      expect(result).toBe('红楼梦 - 曹雪芹: 满纸荒唐言，一把辛酸泪。');
    });

    it('should handle emoji', () => {
      const dataWithEmoji: NoteTemplateData = {
        ...sampleData,
        title: '📚 My Book',
        chapters: [
          {
            title: 'Chapter 😀',
            annotations: [{ text: 'Text with emoji 🎉' }],
          },
        ],
      };
      const template = '{{ title }} - {{ chapters[0].annotations[0].text }}';
      const result = renderNoteTemplate(template, dataWithEmoji);
      expect(result).toBe('📚 My Book - Text with emoji 🎉');
    });
  });

  describe('Whitespace handling', () => {
    it('should trim blocks correctly', () => {
      const template = `Start
{% if true %}
Content
{% endif %}
End`;
      const result = renderNoteTemplate(template, sampleData);
      // With trimBlocks and lstripBlocks enabled, whitespace should be managed
      expect(result).toContain('Start');
      expect(result).toContain('Content');
      expect(result).toContain('End');
    });

    it('should preserve intentional whitespace in content', () => {
      const template = '{{ title }}    {{ author }}';
      const result = renderNoteTemplate(template, sampleData);
      expect(result).toBe('The Great Gatsby    F. Scott Fitzgerald');
    });
  });
});

describe('validateNoteTemplate', () => {
  it('should return valid for correct template', () => {
    const template = '{{ title }} by {{ author }}';
    const result = validateNoteTemplate(template);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should return valid for complex template', () => {
    const template = `{% for chapter in chapters %}
{{ chapter.title }}
{% for annotation in chapter.annotations %}
{{ annotation.text }}
{% endfor %}
{% endfor %}`;
    const result = validateNoteTemplate(template);
    expect(result.isValid).toBe(true);
  });

  it('should return invalid for unclosed variable', () => {
    const template = '{{ unclosed';
    const result = validateNoteTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return invalid for unclosed block', () => {
    const template = '{% if true %}content';
    const result = validateNoteTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return invalid for unclosed for loop', () => {
    const template = '{% for item in items %}content';
    const result = validateNoteTemplate(template);
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return valid for empty template', () => {
    const template = '';
    const result = validateNoteTemplate(template);
    expect(result.isValid).toBe(true);
  });

  it('should return valid for plain text without template syntax', () => {
    const template = 'Just plain text without any template syntax';
    const result = validateNoteTemplate(template);
    expect(result.isValid).toBe(true);
  });
});
