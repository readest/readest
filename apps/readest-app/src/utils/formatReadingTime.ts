/**
 * Format a duration in seconds into a human-readable reading-time string.
 *
 * Examples:
 *   0        → "0m"
 *   30       → "< 1m"
 *   120      → "2m"
 *   3720     → "1h 2m"
 *   7200     → "2h 0m"
 *   86400    → "24h 0m"
 */
export function formatReadingTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m';
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes === 0) return '< 1m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
