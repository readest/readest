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
  return [...documents].sort((left, right) => {
    const a = left.index ?? Infinity;
    const b = right.index ?? Infinity;
    return Math.abs(a - primaryIndex) - Math.abs(b - primaryIndex) || b - a;
  });
};
