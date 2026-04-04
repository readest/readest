import { describe, it, expect } from 'vitest';
import { buildTTSMediaMetadata } from '@/utils/ttsMetadata';

describe('buildTTSMediaMetadata', () => {
  const baseOptions = {
    markText: 'The quick brown fox jumps over the lazy dog.',
    markName: '0',
    sectionLabel: 'Chapter 1: Introduction',
    title: 'Alice in Wonderland',
    author: 'Lewis Carroll',
  };

  describe('sentence mode (default)', () => {
    it('uses mark text as title', () => {
      const result = buildTTSMediaMetadata({ ...baseOptions, ttsMediaMetadata: 'sentence' });
      expect(result.title).toBe(baseOptions.markText);
    });

    it('uses section label as artist', () => {
      const result = buildTTSMediaMetadata({ ...baseOptions, ttsMediaMetadata: 'sentence' });
      expect(result.artist).toBe(baseOptions.sectionLabel);
    });

    it('uses author as album', () => {
      const result = buildTTSMediaMetadata({ ...baseOptions, ttsMediaMetadata: 'sentence' });
      expect(result.album).toBe(baseOptions.author);
    });

    it('falls back to book title when section label is empty', () => {
      const result = buildTTSMediaMetadata({
        ...baseOptions,
        sectionLabel: '',
        ttsMediaMetadata: 'sentence',
      });
      expect(result.artist).toBe(baseOptions.title);
    });

    it('always updates regardless of mark name', () => {
      expect(
        buildTTSMediaMetadata({ ...baseOptions, markName: '0', ttsMediaMetadata: 'sentence' })
          .shouldUpdate,
      ).toBe(true);
      expect(
        buildTTSMediaMetadata({ ...baseOptions, markName: '3', ttsMediaMetadata: 'sentence' })
          .shouldUpdate,
      ).toBe(true);
    });
  });

  describe('paragraph mode', () => {
    it('uses same mapping as sentence mode', () => {
      const sentence = buildTTSMediaMetadata({ ...baseOptions, ttsMediaMetadata: 'sentence' });
      const paragraph = buildTTSMediaMetadata({
        ...baseOptions,
        markName: '0',
        ttsMediaMetadata: 'paragraph',
      });
      expect(paragraph.title).toBe(sentence.title);
      expect(paragraph.artist).toBe(sentence.artist);
      expect(paragraph.album).toBe(sentence.album);
    });

    it('updates on first sentence of a block (markName "0")', () => {
      const result = buildTTSMediaMetadata({
        ...baseOptions,
        markName: '0',
        ttsMediaMetadata: 'paragraph',
      });
      expect(result.shouldUpdate).toBe(true);
    });

    it('skips update for subsequent sentences in the same block', () => {
      expect(
        buildTTSMediaMetadata({ ...baseOptions, markName: '1', ttsMediaMetadata: 'paragraph' })
          .shouldUpdate,
      ).toBe(false);
      expect(
        buildTTSMediaMetadata({ ...baseOptions, markName: '2', ttsMediaMetadata: 'paragraph' })
          .shouldUpdate,
      ).toBe(false);
    });
  });

  describe('chapter mode', () => {
    it('uses section label as title', () => {
      const result = buildTTSMediaMetadata({ ...baseOptions, ttsMediaMetadata: 'chapter' });
      expect(result.title).toBe(baseOptions.sectionLabel);
    });

    it('uses author as artist', () => {
      const result = buildTTSMediaMetadata({ ...baseOptions, ttsMediaMetadata: 'chapter' });
      expect(result.artist).toBe(baseOptions.author);
    });

    it('uses book title as album', () => {
      const result = buildTTSMediaMetadata({ ...baseOptions, ttsMediaMetadata: 'chapter' });
      expect(result.album).toBe(baseOptions.title);
    });

    it('falls back to book title when section label is empty', () => {
      const result = buildTTSMediaMetadata({
        ...baseOptions,
        sectionLabel: '',
        ttsMediaMetadata: 'chapter',
      });
      expect(result.title).toBe(baseOptions.title);
    });

    it('updates when section label differs from previous', () => {
      const result = buildTTSMediaMetadata({
        ...baseOptions,
        ttsMediaMetadata: 'chapter',
        previousSectionLabel: 'Prologue',
      });
      expect(result.shouldUpdate).toBe(true);
    });

    it('skips update when section label matches previous', () => {
      const result = buildTTSMediaMetadata({
        ...baseOptions,
        ttsMediaMetadata: 'chapter',
        previousSectionLabel: 'Chapter 1: Introduction',
      });
      expect(result.shouldUpdate).toBe(false);
    });

    it('updates when no previous section label', () => {
      const result = buildTTSMediaMetadata({
        ...baseOptions,
        ttsMediaMetadata: 'chapter',
      });
      expect(result.shouldUpdate).toBe(true);
    });
  });
});
