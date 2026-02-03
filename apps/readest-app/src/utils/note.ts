import nunjucks from 'nunjucks';

export type NoteTemplateData = {
  title: string;
  author: string;
  exportDate: number;
  chapters: {
    title: string;
    annotations: {
      text: string;
      note?: string;
      style?: string;
      color?: string;
      timestamp?: number;
    }[];
  }[];
};

// Configure nunjucks environment
const env = new nunjucks.Environment(null, {
  autoescape: false, // Don't auto-escape since we're generating markdown
  throwOnUndefined: false, // Return empty string for undefined variables
  trimBlocks: false, // Trim newlines after block tags
  lstripBlocks: true, // Strip leading whitespace before block tags
});

// Add custom 'date' filter for Jinja2 compatibility
// Supports Python strftime-style format strings
env.addFilter('date', (value: number | string | undefined, format?: string) => {
  if (value === undefined || value === null) return '';

  let date: Date;
  // Check if the input is a date-only string (YYYY-MM-DD) which gets parsed as UTC midnight
  // In this case, we should use UTC methods to avoid timezone offset issues
  const isDateOnlyString = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    return value;
  }

  if (isNaN(date.getTime())) return '';

  if (!format) {
    return date.toLocaleString();
  }

  // Convert Python strftime format to actual values
  // Use UTC methods for date-only strings to maintain consistency
  const getYear = () => (isDateOnlyString ? date.getUTCFullYear() : date.getFullYear());
  const getMonth = () => (isDateOnlyString ? date.getUTCMonth() : date.getMonth());
  const getDate = () => (isDateOnlyString ? date.getUTCDate() : date.getDate());
  const getHours = () => (isDateOnlyString ? date.getUTCHours() : date.getHours());
  const getMinutes = () => (isDateOnlyString ? date.getUTCMinutes() : date.getMinutes());
  const getSeconds = () => (isDateOnlyString ? date.getUTCSeconds() : date.getSeconds());
  const getDay = () => (isDateOnlyString ? date.getUTCDay() : date.getDay());

  return format
    .replace(/%Y/g, getYear().toString())
    .replace(/%m/g, String(getMonth() + 1).padStart(2, '0'))
    .replace(/%d/g, String(getDate()).padStart(2, '0'))
    .replace(/%H/g, String(getHours()).padStart(2, '0'))
    .replace(/%M/g, String(getMinutes()).padStart(2, '0'))
    .replace(/%S/g, String(getSeconds()).padStart(2, '0'))
    .replace(/%I/g, String(getHours() % 12 || 12).padStart(2, '0'))
    .replace(/%p/g, getHours() >= 12 ? 'PM' : 'AM')
    .replace(/%w/g, String(getDay()))
    .replace(/%j/g, getDayOfYear(date, isDateOnlyString).toString().padStart(3, '0'))
    .replace(/%U/g, getWeekNumber(date, false, isDateOnlyString).toString().padStart(2, '0'))
    .replace(/%W/g, getWeekNumber(date, true, isDateOnlyString).toString().padStart(2, '0'))
    .replace(
      /%a/g,
      date.toLocaleDateString('en-US', {
        weekday: 'short',
        timeZone: isDateOnlyString ? 'UTC' : undefined,
      }),
    )
    .replace(
      /%A/g,
      date.toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: isDateOnlyString ? 'UTC' : undefined,
      }),
    )
    .replace(
      /%b/g,
      date.toLocaleDateString('en-US', {
        month: 'short',
        timeZone: isDateOnlyString ? 'UTC' : undefined,
      }),
    )
    .replace(
      /%B/g,
      date.toLocaleDateString('en-US', {
        month: 'long',
        timeZone: isDateOnlyString ? 'UTC' : undefined,
      }),
    )
    .replace(/%%/g, '%');
});

// Helper to get day of year
function getDayOfYear(date: Date, useUTC = false): number {
  const year = useUTC ? date.getUTCFullYear() : date.getFullYear();
  const start = useUTC ? new Date(Date.UTC(year, 0, 0)) : new Date(year, 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// Helper to get week number
function getWeekNumber(date: Date, mondayFirst = false, useUTC = false): number {
  const year = useUTC ? date.getUTCFullYear() : date.getFullYear();
  const month = useUTC ? date.getUTCMonth() : date.getMonth();
  const day = useUTC ? date.getUTCDate() : date.getDate();
  const d = new Date(Date.UTC(year, month, day));
  const dayNum = mondayFirst ? d.getUTCDay() || 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Add 'default' filter for providing fallback values
env.addFilter('default', (value: unknown, defaultValue: unknown = '') => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value;
});

// Add 'truncate' filter
env.addFilter('truncate', (value: string, length = 255, killwords = false, end = '...') => {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= length) return value;

  if (killwords) {
    return value.slice(0, length) + end;
  }

  // Find the last word boundary
  let truncated = value.slice(0, length);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 0) {
    truncated = truncated.slice(0, lastSpace);
  }
  return truncated + end;
});

// Add 'trim' filter
env.addFilter('trim', (value: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.trim();
});

// Add 'replace' filter
env.addFilter('replace', (value: string, search: string, replacement: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.split(search).join(replacement);
});

// Add 'upper' and 'lower' filters
env.addFilter('upper', (value: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.toUpperCase();
});

env.addFilter('lower', (value: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.toLowerCase();
});

// Add 'capitalize' filter
env.addFilter('capitalize', (value: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
});

// Add 'title' filter (capitalize each word)
env.addFilter('title', (value: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
});

// Add 'length' filter
env.addFilter('length', (value: string | unknown[]) => {
  if (!value) return 0;
  return value.length;
});

// Add 'first' and 'last' filters
env.addFilter('first', (value: unknown[]) => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value[0];
});

env.addFilter('last', (value: unknown[]) => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value[value.length - 1];
});

// Add 'join' filter
env.addFilter('join', (value: unknown[], separator = '') => {
  if (!Array.isArray(value)) return '';
  return value.join(separator);
});

// Add 'nl2br' filter (convert newlines to <br>)
env.addFilter('nl2br', (value: string) => {
  if (!value || typeof value !== 'string') return '';
  return value.replace(/\n/g, '<br>\n');
});

/**
 * Renders a Jinja2/Nunjucks template with the given data
 * @param template The template string in Jinja2/Nunjucks syntax
 * @param data The data to render the template with
 * @returns The rendered template string
 */
export function renderNoteTemplate(template: string, data: NoteTemplateData): string {
  try {
    return env.renderString(template, data);
  } catch (error) {
    // Return error message in the output for debugging
    const errorMessage = error instanceof Error ? error.message : 'Unknown template error';
    return `[Template Error: ${errorMessage}]\n\n${template}`;
  }
}

/**
 * Validates a template string by attempting to compile it
 * @param template The template string to validate
 * @returns An object with isValid flag and optional error message
 */
export function validateNoteTemplate(template: string): { isValid: boolean; error?: string } {
  try {
    env.renderString(template, {
      title: '',
      author: '',
      exportDate: '',
      chapters: [],
    });
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown template error',
    };
  }
}

/**
 * Get the nunjucks environment instance for advanced use cases
 */
export function getNunjucksEnv(): nunjucks.Environment {
  return env;
}
