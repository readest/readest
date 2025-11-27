const MAX_SNIPPET_LENGTH = 200000;

export const normalizeSnippetText = (text: string): string => {
  const withNormalizedSpaces = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (withNormalizedSpaces.length <= MAX_SNIPPET_LENGTH) {
    return withNormalizedSpaces;
  }

  return `${withNormalizedSpaces.slice(0, MAX_SNIPPET_LENGTH - 3)}...`;
};


