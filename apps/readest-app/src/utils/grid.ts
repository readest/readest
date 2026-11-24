// `split`: the first of two books' share of the screen, in percent, once the
// reader has dragged the divider between them (#4991).
export const getGridTemplate = (count: number, aspectRatio: number, split?: number | null) => {
  if (count <= 1) {
    return { columns: '1fr', rows: '1fr' };
  } else if (count === 2) {
    const tracks = split ? `minmax(0, ${split}fr) minmax(0, ${100 - split}fr)` : '1fr 1fr';
    return aspectRatio < 1 ? { columns: '1fr', rows: tracks } : { columns: tracks, rows: '1fr' };
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
