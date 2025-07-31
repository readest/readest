import { describe, it, expect } from 'vitest';

import { detectLanguage } from '@/utils/lang';

describe('detectLanguage - Result Tests', () => {
  describe('English text detection', () => {
    it('should detect English text', () => {
      const englishTexts = [
        'This is a sample English text for language detection testing.',
        'The quick brown fox jumps over the lazy dog.',
        'Hello world! This is an English sentence with punctuation.',
        'Chapter 1: Introduction to Language Detection',
        'In the beginning was the Word, and the Word was with God.',
        'To be or not to be, that is the question.',
      ];

      englishTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('en');
      });
    });
  });

  describe('Chinese text detection', () => {
    it('should detect Chinese text', () => {
      const chineseTexts = [
        '这是一个中文文本的示例，用于语言检测测试。',
        '天下大势，分久必合，合久必分。',
        '学而时习之，不亦说乎？有朋自远方来，不亦乐乎？',
        '春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。',
        '那时候，天空很蓝，云彩很白，我们都还很年轻。',
        '人工智能技术的发展正在改变我们的生活方式和工作方式。',
      ];

      chineseTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('zh');
      });
    });

    it('should detect Traditional Chinese text', () => {
      const traditionalChineseTexts = [
        '這是一個正體中文文本的示例，用於語言檢測測試。',
        '天下大勢，分久必合，合久必分。',
        '學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？',
        '春眠不覺曉，處處聞啼鳥。夜來風雨聲，花落知多少。',
        '那時候，天空很藍，雲彩很白，我們都還很年輕。',
        '人工智慧技術的發展正在改變我們的生活方式和工作方式。',
      ];

      traditionalChineseTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('zh');
      });
    });
  });

  describe('Japanese text detection', () => {
    it('should detect Japanese text', () => {
      const japaneseTexts = [
        'これは日本語のテキストサンプルです。',
        '第一章：言語検出について',
        'こんにちは、世界！これは日本語の文章です。',
        '桜の花が咲く季節になりました。とても美しいです。',
        'ひらがな、カタカナ、漢字を使って日本語を書きます。',
        '東京は日本の首都であり、多くの人々が住んでいます。',
      ];

      japaneseTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('ja');
      });
    });
  });

  describe('French text detection', () => {
    it('should detect French text', () => {
      const frenchTexts = [
        'Ceci est un exemple de texte français pour tester la détection de langue.',
        'Chapitre 1: Introduction à la détection de langue.',
        'Bonjour le monde! Ceci est une phrase en français.',
        'Les Champs-Élysées sont une avenue célèbre à Paris, souvent appelée la plus belle avenue du monde.',
        'Victor Hugo était un écrivain français très célèbre du XIXe siècle,',
        "La littérature française possède une richesse extraordinaire qui s'étend sur plusieurs siècles.",
      ];

      frenchTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('fr');
      });
    });
  });

  describe('Spanish text detection', () => {
    it('should detect Spanish text', () => {
      const spanishTexts = [
        'Este es un ejemplo de texto en español para probar la detección de idioma.',
        'Capítulo 1: Introducción a la detección de idiomas',
        '¡Hola mundo! Esta es una oración en español.',
        'España es un país ubicado en la península ibérica.',
        'El flamenco es una forma de arte español muy famosa.',
        'Don Quijote de La Mancha es una obra clásica de la literatura española.',
      ];

      spanishTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('es');
      });
    });
  });

  describe('German text detection', () => {
    it('should detect German text', () => {
      const germanTexts = [
        'Dies ist ein Beispieltext auf Deutsch für die Spracherkennung.',
        'Kapitel 1: Einführung in die Spracherkennung',
        'Hallo Welt! Dies ist ein deutscher Satz.',
        'Deutschland ist ein Land in Mitteleuropa.',
        'Das Oktoberfest ist ein berühmtes deutsches Festival.',
        'Die deutsche Sprache hat viele zusammengesetzte Wörter.',
      ];

      germanTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('de');
      });
    });
  });

  describe('Arabic text detection', () => {
    it('should detect Arabic text', () => {
      const arabicTexts = [
        'هذا نص عربي للاختبار. يجب أن يتم اكتشاف هذا النص كعربي.',
        'الفصل الأول: مقدمة في اكتشاف اللغة',
        'مرحبا بالعالم! هذه جملة باللغة العربية.',
        'العربية لغة جميلة يتحدث بها ملايين الناس.',
        'القرآن الكريم نزل باللغة العربية.',
        'دمشق هي عاصمة سوريا وواحدة من أقدم المدن في العالم.',
      ];

      arabicTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('ar');
      });
    });
  });

  describe('Korean text detection', () => {
    it('should detect Korean text', () => {
      const koreanTexts = [
        '이것은 언어 감지 테스트를 위한 한국어 텍스트 샘플입니다.',
        '제1장: 언어 감지 소개',
        '안녕하세요 세계! 이것은 한국어 문장입니다.',
        '서울은 대한민국의 수도이며 많은 사람들이 살고 있습니다.',
        '한글은 세종대왕이 만든 우리나라의 고유한 문자입니다.',
        '김치는 한국의 전통 음식 중 하나입니다.',
      ];

      koreanTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('ko');
      });
    });
  });

  describe('fallback behavior', () => {
    it('should return "en" for very short text', () => {
      const shortTexts = ['', ' ', 'Hi', 'OK', '123', '!@#'];

      shortTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('en');
      });
    });

    it('should return "en" for unrecognizable text', () => {
      const unrecognizableTexts = [
        '123456789012345678901234567890',
        '!@#$%^&*()_+{}|:"<>?[]\\;\',./',
        '1111111111222222222233333333334444444444',
      ];

      unrecognizableTexts.forEach((text) => {
        const result = detectLanguage(text);
        expect(result).toBe('en');
      });
    });
  });

  describe('mixed content', () => {
    it('should detect predominant language in mixed content', () => {
      const testCases = [
        {
          text: 'This is mostly English text with some 中文 words mixed in but English dominates.',
          expected: 'en',
        },
        {
          text: '这主要是中文文本，虽然有一些 English words 混合在其中，但中文占主导地位。',
          expected: 'zh',
        },
        {
          text: 'Ceci est principalement du français avec quelques English words mélangés.',
          expected: 'fr',
        },
      ];

      testCases.forEach(({ text, expected }) => {
        const result = detectLanguage(text);
        expect(result).toBe(expected);
      });
    });
  });

  describe('long text handling', () => {
    it('should handle long text (over 1000 characters)', () => {
      const longEnglishText = 'This is a very long English text. '.repeat(100); // ~3400 chars
      const longChineseText = '这是一个很长的中文文本。'.repeat(100); // ~1200 chars
      const longFrenchText = 'Ceci est un très long texte français. '.repeat(100); // ~3800 chars

      expect(detectLanguage(longEnglishText)).toBe('en');
      expect(detectLanguage(longChineseText)).toBe('zh');
      expect(detectLanguage(longFrenchText)).toBe('fr');
    });
  });

  describe('edge cases with whitespace and formatting', () => {
    it('should handle text with lots of whitespace', () => {
      const textWithWhitespace = '   This   is   English   text   with   lots   of   spaces   ';
      const result = detectLanguage(textWithWhitespace);
      expect(result).toBe('en');
    });

    it('should handle text with newlines and tabs', () => {
      const textWithFormatting = 'This is English text\nwith newlines\tand tabs\nfor formatting.';
      const result = detectLanguage(textWithFormatting);
      expect(result).toBe('en');
    });

    it('should handle text with punctuation', () => {
      const textWithPunctuation = 'Hello, world! How are you? I am fine. Thank you very much!!!';
      const result = detectLanguage(textWithPunctuation);
      expect(result).toBe('en');
    });
  });
});

describe('detectLanguage - Real World Samples', () => {
  it('should detect language in book excerpts', () => {
    const bookExcerpts = [
      {
        text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.',
        expected: 'en',
      },
      {
        text: 'Dans une trou dans la terre vivait un hobbit. Pas un trou déplaisant, sale et humide.',
        expected: 'fr',
      },
      {
        text: '昔々、あるところにおじいさんとおばあさんが住んでいました。',
        expected: 'ja',
      },
      {
        text: '很久很久以前，有一个美丽的公主住在一座城堡里。',
        expected: 'zh',
      },
    ];

    bookExcerpts.forEach(({ text, expected }) => {
      const result = detectLanguage(text);
      expect(result).toBe(expected);
    });
  });
});
