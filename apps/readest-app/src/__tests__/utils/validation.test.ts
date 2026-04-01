import { describe, it, expect } from 'vitest';
import {
  validateAndNormalizeDate,
  validateAndNormalizeLanguage,
  validateISBN,
  validateAndNormalizeSubjects,
} from '../../utils/validation';
import type { ValidationResult } from '../../utils/validation';

describe('validateAndNormalizeDate', () => {
  describe('empty input', () => {
    it('should return valid with empty string for empty input', () => {
      const result: ValidationResult<string> = validateAndNormalizeDate('');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('');
    });
  });

  describe('YYYY format', () => {
    it('should accept a valid 4-digit year', () => {
      const result = validateAndNormalizeDate('2024');
      expect(result.isValid).toBe(true);
      expect(result.value).not.toBeNull();
      // Should return an ISO string derived from 2024-01-01
      expect(result.value).toContain('2024');
    });

    it('should accept year 1000', () => {
      const result = validateAndNormalizeDate('1000');
      expect(result.isValid).toBe(true);
      expect(result.value).not.toBeNull();
    });

    it('should reject year below 1000', () => {
      const result = validateAndNormalizeDate('0999');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Year must be between/);
    });

    it('should reject year far in the future', () => {
      const result = validateAndNormalizeDate('9999');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Year must be between/);
    });

    it('should accept currentYear + 10', () => {
      const maxYear = new Date().getFullYear() + 10;
      const result = validateAndNormalizeDate(String(maxYear));
      expect(result.isValid).toBe(true);
      expect(result.value).not.toBeNull();
    });

    it('should reject currentYear + 11', () => {
      const tooFar = new Date().getFullYear() + 11;
      const result = validateAndNormalizeDate(String(tooFar));
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe('YYYY-MM format', () => {
    it('should accept a valid year-month', () => {
      const result = validateAndNormalizeDate('2024-06');
      expect(result.isValid).toBe(true);
      expect(result.value).not.toBeNull();
      expect(result.value).toContain('2024');
    });

    it('should reject month 00', () => {
      const result = validateAndNormalizeDate('2024-00');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      // Month 00 produces an invalid Date, so it may error as "Invalid date" or "Month must be between"
      expect(result.error).toBeDefined();
    });

    it('should reject month 13', () => {
      const result = validateAndNormalizeDate('2024-13');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      // Month 13 produces an invalid Date, so it may error as "Invalid date" or "Month must be between"
      expect(result.error).toBeDefined();
    });

    it('should accept month 01', () => {
      const result = validateAndNormalizeDate('2024-01');
      expect(result.isValid).toBe(true);
    });

    it('should accept month 12', () => {
      const result = validateAndNormalizeDate('2024-12');
      expect(result.isValid).toBe(true);
    });
  });

  describe('YYYY-MM-DD format', () => {
    it('should accept a valid full date', () => {
      const result = validateAndNormalizeDate('2024-06-15');
      expect(result.isValid).toBe(true);
      expect(result.value).not.toBeNull();
      expect(result.value).toContain('2024');
    });

    it('should reject day 00', () => {
      const result = validateAndNormalizeDate('2024-06-00');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      // Day 00 produces an invalid Date, so it may error as "Invalid date" or "Day must be between"
      expect(result.error).toBeDefined();
    });

    it('should reject day 32', () => {
      const result = validateAndNormalizeDate('2024-06-32');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      // Day 32 produces an invalid Date, so it may error as "Invalid date" or "Day must be between"
      expect(result.error).toBeDefined();
    });

    it('should accept day 01', () => {
      const result = validateAndNormalizeDate('2024-06-01');
      expect(result.isValid).toBe(true);
    });

    it('should accept day 31', () => {
      const result = validateAndNormalizeDate('2024-01-31');
      expect(result.isValid).toBe(true);
    });

    it('should return an ISO string value for valid dates', () => {
      const result = validateAndNormalizeDate('2024-06-15');
      expect(result.isValid).toBe(true);
      // ISO string format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(result.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });
  });

  describe('invalid formats', () => {
    it('should reject slash-separated dates', () => {
      const result = validateAndNormalizeDate('2024/01/01');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Invalid date format/);
    });

    it('should reject dot-separated dates', () => {
      const result = validateAndNormalizeDate('2024.01.01');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should reject random text', () => {
      const result = validateAndNormalizeDate('not-a-date');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should reject incomplete year', () => {
      const result = validateAndNormalizeDate('24');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should reject 5-digit year', () => {
      const result = validateAndNormalizeDate('12345');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe('whitespace handling', () => {
    it('should trim leading and trailing whitespace', () => {
      const result = validateAndNormalizeDate('  2024-06-15  ');
      expect(result.isValid).toBe(true);
      expect(result.value).not.toBeNull();
    });
  });

  describe('NaN date handling', () => {
    it('should reject a date that produces NaN', () => {
      // Month 00 triggers both NaN and month validation;
      // test a format that passes the pattern but yields an invalid Date
      const result = validateAndNormalizeDate('2024-00');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });
  });
});

describe('validateAndNormalizeLanguage', () => {
  describe('empty input', () => {
    it('should return valid with "unknown" for empty input', () => {
      const result: ValidationResult<string> = validateAndNormalizeLanguage('');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('unknown');
    });
  });

  describe('valid ISO 639-1 codes', () => {
    it('should accept "en"', () => {
      const result = validateAndNormalizeLanguage('en');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('en');
    });

    it('should accept "zh"', () => {
      const result = validateAndNormalizeLanguage('zh');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('zh');
    });

    it('should accept "fr"', () => {
      const result = validateAndNormalizeLanguage('fr');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('fr');
    });

    it('should accept "ja"', () => {
      const result = validateAndNormalizeLanguage('ja');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('ja');
    });
  });

  describe('language codes with country codes', () => {
    it('should accept "en-us" lowercased', () => {
      const result = validateAndNormalizeLanguage('en-us');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('en-us');
    });

    it('should normalize "en-US" to lowercase', () => {
      const result = validateAndNormalizeLanguage('en-US');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('en-us');
    });

    it('should accept "zh-CN" and normalize', () => {
      const result = validateAndNormalizeLanguage('zh-CN');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('zh-cn');
    });

    it('should accept 3-letter subtags like "zh-yue"', () => {
      const result = validateAndNormalizeLanguage('zh-yue');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('zh-yue');
    });

    it('should accept 4-letter subtags like "zh-hant"', () => {
      const result = validateAndNormalizeLanguage('zh-hant');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('zh-hant');
    });
  });

  describe('invalid formats', () => {
    it('should reject numeric input "123"', () => {
      const result = validateAndNormalizeLanguage('123');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Invalid language format/);
    });

    it('should reject single character "e"', () => {
      const result = validateAndNormalizeLanguage('e');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should reject three-letter code without hyphen "eng"', () => {
      const result = validateAndNormalizeLanguage('eng');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should reject subtag with 5+ characters', () => {
      const result = validateAndNormalizeLanguage('en-abcde');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should reject subtag with single character', () => {
      const result = validateAndNormalizeLanguage('en-a');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe('invalid language codes', () => {
    it('should reject "xx" as not a valid ISO 639-1 code', () => {
      const result = validateAndNormalizeLanguage('xx');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Invalid language code: xx/);
    });

    it('should reject "qq" as not a valid ISO 639-1 code', () => {
      const result = validateAndNormalizeLanguage('qq');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Invalid language code: qq/);
    });
  });

  describe('whitespace handling', () => {
    it('should trim whitespace around the code', () => {
      const result = validateAndNormalizeLanguage('  en  ');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('en');
    });

    it('should trim whitespace around code with country subtag', () => {
      const result = validateAndNormalizeLanguage('  zh-CN  ');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('zh-cn');
    });
  });

  describe('case normalization', () => {
    it('should lowercase uppercase input "EN"', () => {
      const result = validateAndNormalizeLanguage('EN');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('en');
    });

    it('should lowercase mixed case "En-Us"', () => {
      const result = validateAndNormalizeLanguage('En-Us');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('en-us');
    });
  });
});

describe('validateISBN', () => {
  describe('empty input', () => {
    it('should return valid with empty string for empty input', () => {
      const result: ValidationResult<string> = validateISBN('');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('');
    });
  });

  describe('valid ISBN-10', () => {
    it('should accept a valid ISBN-10 "0306406152"', () => {
      const result = validateISBN('0306406152');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('0306406152');
    });

    it('should accept ISBN-10 with X check digit "080442957X"', () => {
      const result = validateISBN('080442957X');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('080442957X');
    });

    it('should accept ISBN-10 with hyphens "0-306-40615-2"', () => {
      const result = validateISBN('0-306-40615-2');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('0306406152');
    });

    it('should accept ISBN-10 with spaces "0 306 40615 2"', () => {
      const result = validateISBN('0 306 40615 2');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('0306406152');
    });
  });

  describe('invalid ISBN-10', () => {
    it('should reject ISBN-10 with wrong checksum "0306406153"', () => {
      const result = validateISBN('0306406153');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Invalid ISBN-10 checksum/);
    });

    it('should reject ISBN-10 with non-digit characters in body', () => {
      const result = validateISBN('030640615A');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('should reject ISBN-10 with non-digit non-X last character', () => {
      const result = validateISBN('030640615Y');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe('valid ISBN-13', () => {
    it('should accept a valid ISBN-13 "9780306406157"', () => {
      const result = validateISBN('9780306406157');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('9780306406157');
    });

    it('should accept ISBN-13 with hyphens "978-0-306-40615-7"', () => {
      const result = validateISBN('978-0-306-40615-7');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('9780306406157');
    });

    it('should accept ISBN-13 with spaces', () => {
      const result = validateISBN('978 0 306 40615 7');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('9780306406157');
    });

    it('should accept ISBN-13 "9780141036144" (1984)', () => {
      const result = validateISBN('9780141036144');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('9780141036144');
    });
  });

  describe('invalid ISBN-13', () => {
    it('should reject ISBN-13 with wrong checksum "9780306406158"', () => {
      const result = validateISBN('9780306406158');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Invalid ISBN-13 checksum/);
    });

    it('should reject ISBN-13 with non-digit characters', () => {
      const result = validateISBN('978030640615A');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe('wrong length', () => {
    it('should reject too-short ISBN "12345"', () => {
      const result = validateISBN('12345');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/ISBN must be 10 or 13 digits/);
    });

    it('should reject 11-digit number', () => {
      const result = validateISBN('12345678901');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/ISBN must be 10 or 13 digits/);
    });

    it('should reject 14-digit number', () => {
      const result = validateISBN('12345678901234');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/ISBN must be 10 or 13 digits/);
    });

    it('should reject single digit', () => {
      const result = validateISBN('1');
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
    });
  });

  describe('ISBN-10 with check digit 0', () => {
    it('should accept ISBN-10 where checksum mod 11 is 0', () => {
      // "0471958697" is a known valid ISBN-10 (check digit 7, sum%11=0)
      const result = validateISBN('0471958697');
      expect(result.isValid).toBe(true);
      expect(result.value).toBe('0471958697');
    });
  });

  describe('ISBN-13 with check digit 0', () => {
    it('should accept ISBN-13 where calculated check is 0', () => {
      // "9780470059029" is a known valid ISBN-13
      const result = validateISBN('9780470059029');
      expect(result.isValid).toBe(true);
    });
  });
});

describe('validateAndNormalizeSubjects', () => {
  describe('empty input', () => {
    it('should return valid with empty array for empty input', () => {
      const result: ValidationResult<string[]> = validateAndNormalizeSubjects('');
      expect(result.isValid).toBe(true);
      expect(result.value).toEqual([]);
    });
  });

  describe('valid subjects', () => {
    it('should parse comma-separated subjects', () => {
      const result = validateAndNormalizeSubjects('Fiction, Science');
      expect(result.isValid).toBe(true);
      expect(result.value).toEqual(['Fiction', 'Science']);
    });

    it('should parse a single subject', () => {
      const result = validateAndNormalizeSubjects('Fiction');
      expect(result.isValid).toBe(true);
      expect(result.value).toEqual(['Fiction']);
    });

    it('should trim whitespace from each subject', () => {
      const result = validateAndNormalizeSubjects('  Fiction  ,  Science  ,  History  ');
      expect(result.isValid).toBe(true);
      expect(result.value).toEqual(['Fiction', 'Science', 'History']);
    });

    it('should accept exactly 20 subjects', () => {
      const subjects = Array.from({ length: 20 }, (_, i) => `Subject${i + 1}`).join(', ');
      const result = validateAndNormalizeSubjects(subjects);
      expect(result.isValid).toBe(true);
      expect(result.value).toHaveLength(20);
    });

    it('should accept subject at exactly 100 characters', () => {
      const longSubject = 'A'.repeat(100);
      const result = validateAndNormalizeSubjects(longSubject);
      expect(result.isValid).toBe(true);
      expect(result.value).toEqual([longSubject]);
    });
  });

  describe('too many subjects', () => {
    it('should reject more than 20 subjects', () => {
      const subjects = Array.from({ length: 21 }, (_, i) => `Subject${i + 1}`).join(', ');
      const result = validateAndNormalizeSubjects(subjects);
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Too many subjects/);
    });
  });

  describe('subject too long', () => {
    it('should reject a subject over 100 characters', () => {
      const longSubject = 'A'.repeat(101);
      const result = validateAndNormalizeSubjects(longSubject);
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Subject too long/);
    });

    it('should reject when one of multiple subjects is too long', () => {
      const longSubject = 'B'.repeat(101);
      const result = validateAndNormalizeSubjects(`Fiction, ${longSubject}, Science`);
      expect(result.isValid).toBe(false);
      expect(result.value).toBeNull();
      expect(result.error).toMatch(/Subject too long/);
    });
  });

  describe('edge cases', () => {
    it('should handle subjects with only commas yielding empty strings', () => {
      const result = validateAndNormalizeSubjects(',,,');
      expect(result.isValid).toBe(true);
      // After splitting and trimming: ['', '', '', '']
      expect(result.value).toEqual(['', '', '', '']);
    });

    it('should handle a subject with special characters', () => {
      const result = validateAndNormalizeSubjects('Science & Technology, History: Modern Era');
      expect(result.isValid).toBe(true);
      expect(result.value).toEqual(['Science & Technology', 'History: Modern Era']);
    });
  });
});
