export type Preprocessor = (text: string) => string;
export type TextSubstitutions = Record<string, string>;

const defaultSubstitutions: TextSubstitutions = {
  Cover: 'The Cover',
  Dedication: 'Dedication Page',
  Acknowledgements: 'The Acknowledgements',
};

export const basicSubstitute = (text: string, substitutions: TextSubstitutions): string => {
  const allSubstitutions = { ...defaultSubstitutions, ...substitutions };

  if (Object.keys(allSubstitutions).length === 0) {
    return text;
  }

  if (allSubstitutions[text]) {
    return allSubstitutions[text];
  }

  return text;
};

export function createPreprocessor(substitutions: TextSubstitutions = {}): Preprocessor {
  return (text: string) => basicSubstitute(text, substitutions);
}

export function preprocess(texts: string[], substitutions: TextSubstitutions = {}): string[] {
  const preprocessor = createPreprocessor(substitutions);
  return texts.map(preprocessor);
}
