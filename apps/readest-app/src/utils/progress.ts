export function formatReadingProgress(
  current: number | undefined,
  total: number | undefined,
  template: string,
): string {
  if (current === undefined || total === undefined || total <= 0 || current < 0) {
    return '';
  }
  return template
    .replace('{current}', String(current + 1))
    .replace('{total}', String(total))
    .replace('{percent}', (((current + 1) / total) * 100).toFixed(1));
}
