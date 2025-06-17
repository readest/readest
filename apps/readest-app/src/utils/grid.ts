export const getGridTemplate = (count: number, aspectRatio: number) => {
  if (count <= 1) {
    return { columns: '1fr', rows: '1fr' };
  } else if (count === 2) {
    return aspectRatio < 1
      ? { columns: '1fr', rows: '1fr 1fr' }
      : { columns: '1fr 1fr', rows: '1fr' };
  } else if (count === 3 || count === 4) {
    return { columns: '1fr 1fr', rows: '1fr 1fr' };
  } else {
    return { columns: '1fr 1fr 1fr', rows: '1fr 1fr 1fr' };
  }
};

export const getInsetEdges = (index: number, count: number, aspectRatio: number) => {
  const gridTemplate = getGridTemplate(count, aspectRatio);
  const cols = gridTemplate.columns.split(' ').length;
  const rows = gridTemplate.rows.split(' ').length;

  const row = Math.floor(index / cols);
  const col = index % cols;

  return {
    top: row === 0,
    right: col === cols - 1,
    bottom: row === rows - 1,
    left: col === 0,
  };
};
