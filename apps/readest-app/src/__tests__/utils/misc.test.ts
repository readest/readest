import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { makeSafeFilename } from '../../utils/misc';

describe('makeSafeFilename', () => {
  describe('Basic sanitization', () => {
    it('should replace unsafe characters with underscore', () => {
      expect(makeSafeFilename('file<name>.txt')).toBe('file_name_.txt');
      expect(makeSafeFilename('file>name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file:name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file"name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file/name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file\\name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file|name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file?name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file*name.txt')).toBe('file_name.txt');
    });

    it('should replace multiple unsafe characters', () => {
      expect(makeSafeFilename('file<>:"|?*.txt')).toBe('file_______.txt');
    });

    it('should use custom replacement character', () => {
      expect(makeSafeFilename('file<name>.txt', '-')).toBe('file-name-.txt');
      expect(makeSafeFilename('file:name.txt', '')).toBe('filename.txt');
    });

    it('should handle control characters', () => {
      expect(makeSafeFilename('file\x00name.txt')).toBe('file_name.txt');
      expect(makeSafeFilename('file\x1Fname.txt')).toBe('file_name.txt');
    });

    it('should trim whitespace from result', () => {
      expect(makeSafeFilename('  filename.txt  ')).toBe('filename.txt');
      expect(makeSafeFilename('filename.txt ')).toBe('filename.txt');
      expect(makeSafeFilename(' filename.txt')).toBe('filename.txt');
    });
  });

  describe('Reserved filenames (Windows)', () => {
    it('should handle reserved names case-insensitively', () => {
      expect(makeSafeFilename('CON')).toBe('CON_');
      expect(makeSafeFilename('con')).toBe('con_');
      expect(makeSafeFilename('Con')).toBe('Con_');
      expect(makeSafeFilename('PRN')).toBe('PRN_');
      expect(makeSafeFilename('AUX')).toBe('AUX_');
      expect(makeSafeFilename('NUL')).toBe('NUL_');
    });

    it('should handle reserved names with port numbers', () => {
      expect(makeSafeFilename('COM1')).toBe('COM1_');
      expect(makeSafeFilename('COM9')).toBe('COM9_');
      expect(makeSafeFilename('LPT1')).toBe('LPT1_');
      expect(makeSafeFilename('LPT9')).toBe('LPT9_');
    });

    it('should handle reserved names after trimming whitespace', () => {
      expect(makeSafeFilename(' CON ')).toBe('CON_');
      expect(makeSafeFilename(' prn ')).toBe('prn_');
    });

    it('should not affect reserved names with extensions', () => {
      // Reserved names only apply to the base name without extension
      const result = makeSafeFilename('CON.txt');
      expect(result).toBe('CON.txt'); // This might be CON_.txt depending on implementation
    });

    it('should not affect similar but non-reserved names', () => {
      expect(makeSafeFilename('CONFIG')).toBe('CONFIG');
      expect(makeSafeFilename('CONSOLE')).toBe('CONSOLE');
      expect(makeSafeFilename('PRINTER')).toBe('PRINTER');
    });
  });

  describe('Multi-byte UTF-8 characters', () => {
    it('should preserve single multi-byte characters', () => {
      expect(makeSafeFilename('文件.txt')).toBe('文件.txt');
      expect(makeSafeFilename('ファイル.txt')).toBe('ファイル.txt');
      expect(makeSafeFilename('파일.txt')).toBe('파일.txt');
    });

    it('should preserve emoji characters', () => {
      expect(makeSafeFilename('📚 Book.txt')).toBe('📚 Book.txt');
      expect(makeSafeFilename('🎉🎊🎈.txt')).toBe('🎉🎊🎈.txt');
      expect(makeSafeFilename('Test 😀.txt')).toBe('Test 😀.txt');
    });

    it('should handle mixed ASCII and multi-byte characters', () => {
      expect(makeSafeFilename('Book-书籍-本.txt')).toBe('Book-书籍-本.txt');
      expect(makeSafeFilename('Test_测试_テスト.txt')).toBe('Test_测试_テスト.txt');
    });

    it('should preserve complex emoji (with modifiers and ZWJ)', () => {
      expect(makeSafeFilename('👨‍👩‍👧‍👦.txt')).toBe('👨‍👩‍👧‍👦.txt'); // Family emoji with ZWJ
      expect(makeSafeFilename('👍🏽.txt')).toBe('👍🏽.txt'); // Thumbs up with skin tone modifier
    });

    it('should handle combining characters', () => {
      expect(makeSafeFilename('café.txt')).toBe('café.txt'); // é is composed
      expect(makeSafeFilename('naïve.txt')).toBe('naïve.txt');
    });
  });

  describe('Byte length truncation (250 bytes max)', () => {
    it('should not truncate short filenames', () => {
      const shortName = 'short.txt';
      expect(makeSafeFilename(shortName)).toBe(shortName);
    });

    it('should truncate long ASCII filenames', () => {
      const longName = 'a'.repeat(260) + '.txt';
      const result = makeSafeFilename(longName);
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);
    });

    it('should truncate at exactly 250 bytes', () => {
      const longName = 'x'.repeat(255); // More than 250 bytes
      const result = makeSafeFilename(longName);
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBe(250);
    });

    it('should preserve valid UTF-8 when truncating multi-byte characters', () => {
      // Chinese characters: each is 3 bytes in UTF-8
      const chineseChars = '书'.repeat(100); // 300 bytes total
      const result = makeSafeFilename(chineseChars);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      // Verify no broken UTF-8 by encoding and decoding
      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�'); // No replacement characters
    });

    it('should handle Japanese characters when truncating', () => {
      // Japanese hiragana: each is 3 bytes in UTF-8
      const japaneseChars = 'あ'.repeat(100); // 300 bytes
      const result = makeSafeFilename(japaneseChars);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�');
    });

    it('should handle emoji when truncating', () => {
      // Most emoji are 4 bytes in UTF-8
      const emojiString = '😀'.repeat(70); // 280 bytes
      const result = makeSafeFilename(emojiString);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�');
    });

    it('should handle mixed-width characters when truncating', () => {
      // Mix of 1-byte (ASCII), 2-byte (Latin extended), 3-byte (CJK), 4-byte (emoji)
      const mixedString = 'Test测试тест😀'.repeat(20); // Over 250 bytes
      const result = makeSafeFilename(mixedString);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�');
    });

    it('should handle Korean characters when truncating', () => {
      // Korean characters: each is 3 bytes in UTF-8
      const koreanChars = '가'.repeat(100); // 300 bytes
      const result = makeSafeFilename(koreanChars);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(makeSafeFilename('')).toBe('');
    });

    it('should handle string with only unsafe characters', () => {
      expect(makeSafeFilename('<>:"|?*#')).toBe('________');
    });

    it('should handle string that becomes empty after sanitization and trimming', () => {
      const result = makeSafeFilename('   ');
      expect(result).toBe('');
    });

    it('should handle very long extension', () => {
      const longExt = '.txt'.repeat(50);
      const filename = 'file' + longExt;
      const result = makeSafeFilename(filename);
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);
    });

    it('should handle filename with only whitespace', () => {
      expect(makeSafeFilename('     ')).toBe('');
    });

    it('should handle complex real-world Chinese book title', () => {
      const longTitle =
        '这是一个非常长的中文书名用来测试文件名处理功能这个标题包含了很多汉字字符'.repeat(3) +
        '.epub';
      const result = makeSafeFilename(longTitle);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      // Verify UTF-8 validity
      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�');
    });

    it('should handle complex real-world Chinese book title', () => {
      const longTitle =
        '榎宮祐 - NO GAME NO LIFE 遊戲人生 02 遊戲玩家兄妹似乎盯上獸耳娘的國家了'.repeat(3);
      const result = makeSafeFilename(longTitle);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      // Verify UTF-8 validity
      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�');
    });

    it('should handle complex real-world Chinese book titles with varying zero padding', () => {
      const testCases = Array.from({ length: 31 }, (_, i) => {
        const padding = '0'.repeat(i) + '2';
        return `榎宮祐 - ${'NO GAME NO LIFE'.repeat(12)} 遊戲人生 ${padding} 遊戲玩家兄妹似乎盯上獸耳娘的國家了`;
      });

      for (const longTitle of testCases) {
        const result = makeSafeFilename(longTitle);
        const byteLength = new TextEncoder().encode(result).length;

        expect(byteLength).toBeLessThanOrEqual(250);

        const encoded = new TextEncoder().encode(result);
        const decoded = new TextDecoder().decode(encoded);

        expect(decoded).toBe(result);
        expect(decoded).not.toContain('�');
      }
    });

    it('should handle right-to-left text (Arabic)', () => {
      const arabicName = 'كتاب'.repeat(50) + '.pdf'; // Over 250 bytes
      const result = makeSafeFilename(arabicName);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
    });

    it('should handle Cyrillic characters', () => {
      const cyrillicName = 'Книга'.repeat(60) + '.txt'; // Over 250 bytes
      const result = makeSafeFilename(cyrillicName);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
    });

    it('should handle Thai characters', () => {
      const thaiName = 'หนังสือ'.repeat(50) + '.pdf'; // Over 250 bytes
      const result = makeSafeFilename(thaiName);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
    });
  });

  describe('Combined sanitization and truncation', () => {
    it('should sanitize and truncate in correct order', () => {
      const unsafeLongName = '<'.repeat(260) + '.txt';
      const result = makeSafeFilename(unsafeLongName);

      // Should replace < with _, then truncate
      expect(result).not.toContain('<');
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);
    });

    it('should handle reserved name that needs truncation', () => {
      // Edge case: reserved name with very long content
      const longReservedLike = 'CON' + 'x'.repeat(260);
      const result = makeSafeFilename(longReservedLike);

      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);
    });

    it('should sanitize, handle reserved names, and truncate multi-byte characters', () => {
      const complexName = 'CON:文件'.repeat(50) + '😀'.repeat(20);
      const result = makeSafeFilename(complexName);

      // Should not contain unsafe characters
      expect(result).not.toContain(':');

      // Should be within byte limit
      const byteLength = new TextEncoder().encode(result).length;
      expect(byteLength).toBeLessThanOrEqual(250);

      // Should be valid UTF-8
      const encoded = new TextEncoder().encode(result);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(result);
      expect(decoded).not.toContain('�');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical book title with author', () => {
      const bookTitle = 'The Great Gatsby - F. Scott Fitzgerald.epub';
      expect(makeSafeFilename(bookTitle)).toBe('The Great Gatsby - F. Scott Fitzgerald.epub');
    });

    it('should handle Chinese book with long title', () => {
      const chineseBook = '红楼梦：中国古典文学四大名著之一（全120回完整版）.epub';
      const result = makeSafeFilename(chineseBook);
      expect(result).toBe(chineseBook); // Should fit within 250 bytes
    });

    it('should handle Japanese light novel title', () => {
      const japaneseTitle = 'ソードアート・オンライン：アリシゼーション編.epub';
      expect(makeSafeFilename(japaneseTitle)).toBe(japaneseTitle);
    });

    it('should handle filename with unsafe characters and emoji', () => {
      const unsafeEmoji = '📚 Book: "Title" <Part 1>.epub';
      const result = makeSafeFilename(unsafeEmoji);
      expect(result).toBe('📚 Book_ _Title_ _Part 1_.epub');
    });

    it('should handle Windows-style path in filename', () => {
      const windowsPath = 'C:\\Users\\Documents\\book.pdf';
      const result = makeSafeFilename(windowsPath);
      expect(result).toBe('C__Users_Documents_book.pdf');
    });

    it('should handle URL in filename', () => {
      const url = 'https://example.com/book.pdf';
      const result = makeSafeFilename(url);
      expect(result).toBe('https___example.com_book.pdf');
    });
  });

  describe('Property checks', () => {
    it('should keep sanitized filenames bounded, safe, trimmed, and stable', () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 1000 }), (filename) => {
          const result = makeSafeFilename(filename);

          expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(250);
          expect(result).not.toMatch(/[<>:%#"\/\\|?*\x00-\x1F]/);
          expect(result).toBe(result.trim());
          expect(makeSafeFilename(result)).toBe(result);
        }),
        { numRuns: 200 },
      );
    });
  });
});
