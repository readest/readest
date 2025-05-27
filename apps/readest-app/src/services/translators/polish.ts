export type Polisher = (text: string) => string;

const languagePolishers: Record<string, Polisher> = {
  // Chinese - fix punctuation spacing
  zh: (text: string) =>
    text
      .replace(/--/g, '⸺')
      .replace(/\s+([。、！？])/g, '$1')
      .replace(/([。、！？])\s+/g, '$1'),

  // Spanish - fix punctuation spacing
  es: (text: string) =>
    text.replace(/\?([A-ZÁÉÍÓÚÑÜ])/g, '? $1').replace(/\!([A-ZÁÉÍÓÚÑÜ])/g, '! $1'),

  // French - fix punctuation spacing
  fr: (text: string) => text.replace(/\s+([!?:;])/g, ' $1').replace(/([!?:;])\s+/g, '$1 '),

  // Japanese - fix punctuation spacing
  ja: (text: string) => text.replace(/\s+([。、！？])/g, '$1').replace(/([。、！？])\s+/g, '$1'),
};

export const basicPolish: Polisher = (text: string) => {
  return text
    .replace(/\s+/g, ' ') // Multiple spaces to single space
    .replace(/\s+([.,!?;:])/g, '$1') // Remove space before punctuation
    .trim();
};

export function getPolisher(targetLang: string): Polisher {
  const langCode = targetLang.split('-')[0]!.toLowerCase();
  const languagePolisher = languagePolishers[langCode];

  if (languagePolisher) {
    return (text: string) => {
      const basicPolished = basicPolish(text);
      const polished = languagePolisher(basicPolished);
      return polished;
    };
  }

  return basicPolish;
}

export function polish(texts: string[], targetLang: string): string[] {
  const polisher = getPolisher(targetLang);
  return texts.map(polisher);
}
