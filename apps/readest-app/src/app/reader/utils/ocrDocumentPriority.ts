interface RenderedDocument {
  index?: number;
}

export const prioritizeCurrentDocument = <T extends RenderedDocument>(renderer: {
  getContents: () => readonly T[];
  primaryIndex?: number;
  index?: number;
}): T[] => {
  const documents = renderer.getContents();
  const primaryIndex = renderer.primaryIndex ?? renderer.index;
  if (typeof primaryIndex !== 'number') return [...documents];
  const current = documents.find((document) => document.index === primaryIndex);
  if (!current) return [...documents];
  return [current, ...documents.filter((document) => document !== current)];
};
