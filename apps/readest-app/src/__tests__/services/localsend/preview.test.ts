import { describe, expect, it } from 'vitest';
import { previewDataUrl } from '@/services/localsend/preview';

describe('previewDataUrl', () => {
  it('wraps a JPEG thumbnail in a data URL', () => {
    expect(previewDataUrl('/9j/4AAQSkZJRg==')).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
  });

  it('wraps a PNG thumbnail in a data URL', () => {
    expect(previewDataUrl('iVBORw0KGgoAAAANSUhEUg==')).toBe(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    );
  });

  it('rejects previews that are missing, unrecognized, or not base64', () => {
    expect(previewDataUrl(null)).toBe(null);
    expect(previewDataUrl(undefined)).toBe(null);
    expect(previewDataUrl('')).toBe(null);
    // Unknown magic bytes: refuse rather than guess a mime type.
    expect(previewDataUrl('AAAAAAAAAAAA')).toBe(null);
    // A data URL prefix or any non-base64 character must not pass through
    // into the img src.
    expect(previewDataUrl('data:image/jpeg;base64,/9j/AAA')).toBe(null);
    expect(previewDataUrl('/9j/"><script>')).toBe(null);
  });

  it('rejects absurdly large previews from a hostile peer', () => {
    expect(previewDataUrl(`/9j/${'A'.repeat(512 * 1024)}`)).toBe(null);
  });
});
