import { describe, expect, it } from 'vitest';
import { getSectionDocumentType, normalizeMediaType } from '@/services/transformers/sanitizer';

describe('normalizeMediaType', () => {
  it('lowercases and drops parameters', () => {
    expect(normalizeMediaType('Application/XHTML+xml; charset=utf-8')).toBe(
      'application/xhtml+xml',
    );
    expect(normalizeMediaType(' text/HTML ')).toBe('text/html');
    expect(normalizeMediaType('image/SVG+xml;foo=bar')).toBe('image/svg+xml');
  });

  it('maps a missing type to an empty string', () => {
    expect(normalizeMediaType(undefined)).toBe('');
    expect(normalizeMediaType(null)).toBe('');
  });
});

describe('getSectionDocumentType', () => {
  it('keeps the document types the sanitizers handle', () => {
    expect(getSectionDocumentType('application/xhtml+xml')).toBe('application/xhtml+xml');
    expect(getSectionDocumentType('text/html')).toBe('text/html');
    expect(getSectionDocumentType('image/svg+xml')).toBe('image/svg+xml');
  });

  it('keeps passive media types', () => {
    expect(getSectionDocumentType('image/jpeg')).toBe('image/jpeg');
    expect(getSectionDocumentType('video/mp4')).toBe('video/mp4');
    expect(getSectionDocumentType('audio/mpeg')).toBe('audio/mpeg');
  });

  it('serves XML, missing and unknown section types as plain text', () => {
    for (const type of [
      'text/xml',
      'application/xml',
      'application/mathml+xml',
      'image/x-chapter+xml',
      'video/x-foo+xml',
      '',
      'foo/bar',
    ]) {
      expect(getSectionDocumentType(type)).toBe('text/plain');
    }
  });
});
