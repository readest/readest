interface RenderedDocument {
  index?: number;
}

export const prioritizeCurrentDocument = <T extends RenderedDocument>(
  documents: readonly T[],
  primaryIndex: number | undefined,
): T[] => {
  if (typeof primaryIndex !== 'number') return [...documents];
  const current = documents.find((document) => document.index === primaryIndex);
  if (!current) return [...documents];
  return [current, ...documents.filter((document) => document !== current)];
};
