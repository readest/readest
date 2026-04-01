import { describe, it, expect, beforeEach } from 'vitest';
import dayjs from 'dayjs';
import { initDayjs } from '@/utils/time';

describe('initDayjs', () => {
  beforeEach(() => {
    // Reset dayjs locale to default before each test
    dayjs.locale('en');
  });

  it('should set the locale to English', () => {
    initDayjs('en');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('January');
  });

  it('should set the locale to Chinese', () => {
    initDayjs('zh');
    const formatted = dayjs('2024-01-15').format('MMMM');
    // Chinese locale uses Chinese month names
    expect(formatted).toBe('一月');
  });

  it('should set the locale to Japanese', () => {
    initDayjs('ja');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('1月');
  });

  it('should set the locale to German', () => {
    initDayjs('de');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('Januar');
  });

  it('should set the locale to Korean', () => {
    initDayjs('ko');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('1월');
  });

  it('should set the locale to Russian', () => {
    initDayjs('ru');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('январь');
  });

  it('should set the locale to French', () => {
    initDayjs('fr');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('janvier');
  });

  it('should set the locale to Spanish', () => {
    initDayjs('es');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('enero');
  });

  it('should set the locale to Italian', () => {
    initDayjs('it');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('gennaio');
  });

  it('should set the locale to Portuguese', () => {
    initDayjs('pt');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('janeiro');
  });

  it('should set the locale to Portuguese (Brazil)', () => {
    initDayjs('pt-br');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('janeiro');
  });

  it('should set the locale to Traditional Chinese (Taiwan)', () => {
    initDayjs('zh-tw');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('一月');
  });

  it('should set the locale to Simplified Chinese', () => {
    initDayjs('zh-cn');
    const formatted = dayjs('2024-01-15').format('MMMM');
    expect(formatted).toBe('一月');
  });

  it('should enable relativeTime plugin', () => {
    initDayjs('en');
    // dayjs().fromNow() should work after extending relativeTime
    const past = dayjs().subtract(3, 'hour');
    const result = past.fromNow();
    expect(result).toBe('3 hours ago');
  });

  it('should enable relativeTime with a different locale', () => {
    initDayjs('zh');
    const past = dayjs().subtract(1, 'day');
    const result = past.fromNow();
    // Chinese relative time
    expect(result).toBe('1 天前');
  });

  it('should enable relativeTime for French', () => {
    initDayjs('fr');
    const past = dayjs().subtract(5, 'minute');
    const result = past.fromNow();
    expect(result).toBe('il y a 5 minutes');
  });

  it('should handle locale switching', () => {
    initDayjs('en');
    expect(dayjs('2024-03-15').format('MMMM')).toBe('March');

    initDayjs('de');
    expect(dayjs('2024-03-15').format('MMMM')).toBe('März');

    initDayjs('ja');
    expect(dayjs('2024-03-15').format('MMMM')).toBe('3月');
  });

  it('should work with day formatting after locale change', () => {
    initDayjs('en');
    const formatted = dayjs('2024-01-15').format('dddd');
    expect(formatted).toBe('Monday');
  });

  it('should work with day formatting in Japanese', () => {
    initDayjs('ja');
    const formatted = dayjs('2024-01-15').format('dddd');
    expect(formatted).toBe('月曜日');
  });
});
