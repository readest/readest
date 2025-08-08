export function formatReadingProgress(
  current: number,
  total: number,
  style: 'percentage' | 'fraction',
): string {
  if (style === 'fraction') {
    return `${current + 1} / ${total}`;
  } else {
    const progress = current / total;
    return `${(progress * 100).toFixed(1)}%`;
  }
}
