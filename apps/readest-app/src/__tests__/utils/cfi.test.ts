import { describe, it, expect } from 'vitest';
import { isCfiInLocation, findNearestCfi } from '@/utils/cfi';

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
