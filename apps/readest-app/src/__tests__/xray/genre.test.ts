import { describe, expect, test } from 'vitest';

import { detectGenre } from '@/services/ai/xray/genre';

describe('detectGenre', () => {
  test('uses explicit metadata and returns extraction hints', () => {
    const result = detectGenre({
      subject: ['Fantasy'],
      description: 'A wizard crosses a magical realm to find a dragon.',
    });

    expect(result.genre).toBe('fantasy');
    expect(result.extractionFocus).toContain('magic systems');
    expect(result.hints.some((hint) => hint.includes('artifacts'))).toBe(true);
  });
});
