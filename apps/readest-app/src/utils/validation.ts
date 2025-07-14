/**
 * Validation utilities for metadata fields
 */

// ISO 639-1 language codes (2-letter codes)
// prettier-ignore
const ISO_639_1_CODES = new Set([
  'aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az',
  'ba', 'be', 'bg', 'bh', 'bi', 'bm', 'bn', 'bo', 'br', 'bs',
  'ca', 'ce', 'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy',
  'da', 'de', 'dv', 'dz',
  'ee', 'el', 'en', 'eo', 'es', 'et', 'eu',
  'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy',
  'ga', 'gd', 'gl', 'gn', 'gu', 'gv',
  'ha', 'he', 'hi', 'ho', 'hr', 'ht', 'hu', 'hy', 'hz',
  'ia', 'id', 'ie', 'ig', 'ii', 'ik', 'io', 'is', 'it', 'iu',
  'ja', 'jv',
  'ka', 'kg', 'ki', 'kj', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'kw', 'ky',
  'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lu', 'lv',
  'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my',
  'na', 'nb', 'nd', 'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv', 'ny',
  'oc', 'oj', 'om', 'or', 'os',
  'pa', 'pi', 'pl', 'ps', 'pt',
  'qu',
  'rm', 'rn', 'ro', 'ru', 'rw',
  'sa', 'sc', 'sd', 'se', 'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw',
  'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw', 'ty',
  'ug', 'uk', 'ur', 'uz',
  've', 'vi', 'vo',
  'wa', 'wo',
  'xh',
  'yi', 'yo',
  'za', 'zh', 'zu'
]);

export interface ValidationResult<T> {
  isValid: boolean;
  value: T | null;
  error?: string;
}

/**
 * Validates and normalizes date input
 * Accepts YYYY, YYYY-MM, or YYYY-MM-DD formats
 * Returns ISO string if valid, null if invalid
 */
export const validateAndNormalizeDate = (dateInput: string): ValidationResult<string> => {
  if (!dateInput) {
    return { isValid: true, value: '' };
  }

  const cleaned = dateInput.trim();
  // Pattern for YYYY, YYYY-MM, or YYYY-MM-DD
  const datePatterns = [
    { pattern: /^\d{4}$/, format: 'YYYY' },
    { pattern: /^\d{4}-\d{2}$/, format: 'YYYY-MM' },
    { pattern: /^\d{4}-\d{2}-\d{2}$/, format: 'YYYY-MM-DD' },
  ];

  const matchingPattern = datePatterns.find(({ pattern }) => pattern.test(cleaned));
  if (!matchingPattern) {
    return {
      isValid: false,
      value: null,
      error: 'Invalid date format. Use YYYY, YYYY-MM, or YYYY-MM-DD',
    };
  }

  try {
    let date: Date;

    if (cleaned.length === 4) {
      // YYYY format - set to January 1st
      date = new Date(`${cleaned}-01-01`);
    } else if (cleaned.length === 7) {
      // YYYY-MM format - set to 1st day of month
      date = new Date(`${cleaned}-01`);
    } else {
      // YYYY-MM-DD format
      date = new Date(cleaned);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        value: null,
        error: 'Invalid date',
      };
    }

    // Check if year is reasonable (between 1000 and current year + 10)
    const year = date.getFullYear();
    const currentYear = new Date().getFullYear();
    if (year < 1000 || year > currentYear + 10) {
      return {
        isValid: false,
        value: null,
        error: `Year must be between 1000 and ${currentYear + 10}`,
      };
    }

    // Validate month and day if provided
    if (cleaned.length >= 7) {
      const month = parseInt(cleaned.substring(5, 7));
      if (month < 1 || month > 12) {
        return {
          isValid: false,
          value: null,
          error: 'Month must be between 01 and 12',
        };
      }
    }

    if (cleaned.length === 10) {
      const day = parseInt(cleaned.substring(8, 10));
      if (day < 1 || day > 31) {
        return {
          isValid: false,
          value: null,
          error: 'Day must be between 01 and 31',
        };
      }
    }

    return {
      isValid: true,
      value: date.toISOString(),
    };
  } catch {
    return {
      isValid: false,
      value: null,
      error: 'Failed to parse date',
    };
  }
};

/**
 * Validates and normalizes language code input
 * Accepts ISO 639-1 codes with optional country codes (e.g., en, en-US, zh-CN)
 * Returns normalized language code if valid, null if invalid
 */
export const validateAndNormalizeLanguage = (languageInput: string): ValidationResult<string> => {
  if (!languageInput) {
    return { isValid: true, value: 'unknown' };
  }

  const cleaned = languageInput.trim().toLowerCase();
  // Pattern for language codes with optional country codes (e.g., en-US, zh-CN)
  const languagePattern = /^[a-z]{2}(-[a-z]{2,4})?$/i;
  if (!languagePattern.test(cleaned)) {
    return {
      isValid: false,
      value: null,
      error: 'Invalid language format. Use ISO 639-1 codes (e.g., en, zh-CN)',
    };
  }

  const languageCode = cleaned.substring(0, 2);
  if (!ISO_639_1_CODES.has(languageCode)) {
    return {
      isValid: false,
      value: null,
      error: `Invalid language code: ${languageCode}. Must be a valid ISO 639-1 code`,
    };
  }

  return {
    isValid: true,
    value: cleaned,
  };
};

export const validateISBN = (isbn: string): ValidationResult<string> => {
  if (!isbn) {
    return { isValid: true, value: '' };
  }

  const cleaned = isbn.replace(/[-\s]/g, '');
  if (cleaned.length !== 10 && cleaned.length !== 13) {
    return {
      isValid: false,
      value: null,
      error: 'ISBN must be 10 or 13 digits',
    };
  }

  // Validate ISBN-10
  if (cleaned.length === 10) {
    const isValid = validateISBN10(cleaned);
    return {
      isValid,
      value: isValid ? cleaned : null,
      error: isValid ? undefined : 'Invalid ISBN-10 checksum',
    };
  }

  // Validate ISBN-13
  if (cleaned.length === 13) {
    const isValid = validateISBN13(cleaned);
    return {
      isValid,
      value: isValid ? cleaned : null,
      error: isValid ? undefined : 'Invalid ISBN-13 checksum',
    };
  }

  return { isValid: false, value: null, error: 'Invalid ISBN format' };
};

const validateISBN10 = (isbn: string): boolean => {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const digit = parseInt(isbn[i]!);
    if (isNaN(digit)) return false;
    sum += digit * (10 - i);
  }

  const lastChar = isbn[9]!;
  const checkDigit = lastChar === 'X' ? 10 : parseInt(lastChar);
  if (isNaN(checkDigit)) return false;

  sum += checkDigit;
  return sum % 11 === 0;
};

const validateISBN13 = (isbn: string): boolean => {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(isbn[i]!);
    if (isNaN(digit)) return false;
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }

  const checkDigit = parseInt(isbn[12]!);
  if (isNaN(checkDigit)) return false;

  const calculatedCheck = (10 - (sum % 10)) % 10;
  return checkDigit === calculatedCheck;
};

/**
 * Validates subjects/genres input
 * Accepts comma-separated values and returns cleaned array
 */
export const validateAndNormalizeSubjects = (subjectsInput: string): ValidationResult<string[]> => {
  if (!subjectsInput) {
    return { isValid: true, value: [] };
  }

  const subjects = subjectsInput.split(',').map((s) => s.trim());

  const maxSubjects = 20;
  const maxSubjectLength = 100;

  if (subjects.length > maxSubjects) {
    return {
      isValid: false,
      value: null,
      error: `Too many subjects (max ${maxSubjects})`,
    };
  }

  const tooLongSubject = subjects.find((s) => s.length > maxSubjectLength);
  if (tooLongSubject) {
    return {
      isValid: false,
      value: null,
      error: `Subject too long (max ${maxSubjectLength} characters): ${tooLongSubject}`,
    };
  }

  return {
    isValid: true,
    value: subjects,
  };
};
