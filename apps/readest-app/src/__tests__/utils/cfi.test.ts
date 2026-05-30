import { describe, it, expect } from 'vitest';
import { isCfiInLocation, findNearestCfi, isMalformedLocationCfi } from '@/utils/cfi';

describe('isCfiInLocation', () => {
  it('should return true when cfi path starts with location path', () => {
    expect(isCfiInLocation('epubcfi(/6/6!/4/4/54,/1:4,/1:15)', 'epubcfi(/6/6)')).toBe(true);
  });

  it('should return true for exact match', () => {
    expect(isCfiInLocation('epubcfi(/6/6)', 'epubcfi(/6/6)')).toBe(true);
  });

  it('should return false when cfi is in a different section', () => {
    expect(isCfiInLocation('epubcfi(/6/8!/4/4/54,/1:4,/1:15)', 'epubcfi(/6/6)')).toBe(false);
  });

  it('should return false for null/undefined location', () => {
    expect(isCfiInLocation('epubcfi(/6/6)', null)).toBe(false);
    expect(isCfiInLocation('epubcfi(/6/6)', undefined)).toBe(false);
  });

  it('should return false for null/undefined/empty cfi', () => {
    expect(isCfiInLocation(null as unknown as string, 'epubcfi(/6/6)')).toBe(false);
    expect(isCfiInLocation(undefined as unknown as string, 'epubcfi(/6/6)')).toBe(false);
    expect(isCfiInLocation('', 'epubcfi(/6/6)')).toBe(false);
  });
});

describe('findNearestCfi', () => {
  const sortedCfis = [
    'epubcfi(/6/4!/4/2:0)',
    'epubcfi(/6/6!/4/4:0)',
    'epubcfi(/6/6!/4/10:0)',
    'epubcfi(/6/8!/4/2:0)',
    'epubcfi(/6/10!/4/6:0)',
  ];

  it('should return the nearest cfi before the location', () => {
    // location is between index 1 and 2 — nearest is index 1
    const result = findNearestCfi(sortedCfis, 'epubcfi(/6/6!/4/6:0)');
    expect(result).toBe('epubcfi(/6/6!/4/4:0)');
  });

  it('should return the last cfi when location is after all items', () => {
    const result = findNearestCfi(sortedCfis, 'epubcfi(/6/20!/4/2:0)');
    expect(result).toBe('epubcfi(/6/10!/4/6:0)');
  });

  it('should return the first cfi when location is before all items', () => {
    const result = findNearestCfi(sortedCfis, 'epubcfi(/6/2!/4/2:0)');
    expect(result).toBe('epubcfi(/6/4!/4/2:0)');
  });

  it('should return exact match when location matches a cfi', () => {
    const result = findNearestCfi(sortedCfis, 'epubcfi(/6/6!/4/4:0)');
    expect(result).toBe('epubcfi(/6/6!/4/4:0)');
  });

  it('should return null for empty array', () => {
    expect(findNearestCfi([], 'epubcfi(/6/6!/4/4:0)')).toBeNull();
  });

  it('should return null for null/undefined location', () => {
    expect(findNearestCfi(sortedCfis, null)).toBeNull();
    expect(findNearestCfi(sortedCfis, undefined)).toBeNull();
  });
});

describe('isMalformedLocationCfi', () => {
  it('flags an empty-start range CFI', () => {
    // Produced by the cfi-inert skip-link bug: the visible-range start anchored
    // on the injected a11y skip-link, foliate dropped that inert step, and the
    // range start went empty (the `,,`). Resolving it spans the whole section
    // and jumps to the wrong end, so the location must be discarded.
    expect(isMalformedLocationCfi('epubcfi(/6/24!/4,,/20/1:58)')).toBe(true);
  });

  it('flags an empty-end range CFI', () => {
    expect(isMalformedLocationCfi('epubcfi(/6/24!/4,/18/1:0,)')).toBe(true);
  });

  it('does not flag a well-formed range CFI', () => {
    expect(isMalformedLocationCfi('epubcfi(/6/6!/4/4/54,/1:4,/1:15)')).toBe(false);
  });

  it('does not flag a point CFI', () => {
    expect(isMalformedLocationCfi('epubcfi(/6/24!/4/20/1:58)')).toBe(false);
  });
});
