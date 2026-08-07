import { describe, test, expect } from 'vitest';
import { annotationToolButtons } from '@/app/reader/components/annotator/AnnotationTools';
import {
  ALL_ANNOTATION_TOOL_TYPES,
  DEFAULT_ANNOTATION_TOOLBAR_ITEMS,
  getToolbarToolTypes,
  getAvailableToolTypes,
  addToolToToolbar,
  removeToolFromToolbar,
  reorderToolbar,
  supportsProofread,
} from '@/utils/annotationToolbar';

describe('annotationToolbar helpers', () => {
  test('ALL_ANNOTATION_TOOL_TYPES matches the button registry order', () => {
    expect(ALL_ANNOTATION_TOOL_TYPES).toEqual(annotationToolButtons.map((b) => b.type));
  });

  test('default toolbar is the eight non-share tools in canonical order', () => {
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).toEqual([
      'copy',
      'highlight',
      'annotate',
      'search',
      'dictionary',
      'translate',
      'tts',
      'proofread',
    ]);
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('share');
  });

  test('copylink is opt-in: off the default toolbar, offered in the available tray', () => {
    expect(ALL_ANNOTATION_TOOL_TYPES).toContain('copylink');
    expect(DEFAULT_ANNOTATION_TOOLBAR_ITEMS).not.toContain('copylink');
    expect(getToolbarToolTypes(undefined, true)).not.toContain('copylink');
    expect(getAvailableToolTypes(DEFAULT_ANNOTATION_TOOLBAR_ITEMS, true)).toContain('copylink');
    expect(getToolbarToolTypes([...DEFAULT_ANNOTATION_TOOLBAR_ITEMS, 'copylink'], true)).toContain(
      'copylink',
    );
  });

  test('getToolbarToolTypes preserves order and falls back to default when undefined', () => {
    expect(getToolbarToolTypes(undefined, true)).toEqual(DEFAULT_ANNOTATION_TOOLBAR_ITEMS);
    expect(getToolbarToolTypes(['search', 'copy'], true)).toEqual(['search', 'copy']);
  });

  test('getToolbarToolTypes drops share when !canShare, keeps it when canShare', () => {
    expect(getToolbarToolTypes(['copy', 'share'], false)).toEqual(['copy']);
    expect(getToolbarToolTypes(['copy', 'share'], true)).toEqual(['copy', 'share']);
  });

  test('getToolbarToolTypes drops unknown/duplicate entries', () => {
    expect(getToolbarToolTypes(['copy', 'copy', 'bogus' as never], true)).toEqual(['copy']);
  });

  test('getAvailableToolTypes returns canonical-order complement', () => {
    expect(getAvailableToolTypes(['copy'], true)).toEqual([
      'copylink',
      'highlight',
      'annotate',
      'search',
      'dictionary',
      'translate',
      'tts',
      'proofread',
      'share',
    ]);
  });

  test('getAvailableToolTypes hides share when !canShare', () => {
    expect(getAvailableToolTypes(['copy'], false)).not.toContain('share');
  });

  test('addToolToToolbar appends by default and is a no-op when present', () => {
    expect(addToolToToolbar(['copy'], 'share')).toEqual(['copy', 'share']);
    expect(addToolToToolbar(['copy', 'share'], 'share')).toEqual(['copy', 'share']);
  });

  test('addToolToToolbar inserts at the given index', () => {
    expect(addToolToToolbar(['copy', 'search'], 'share', 1)).toEqual(['copy', 'share', 'search']);
  });

  test('removeToolFromToolbar removes the tool', () => {
    expect(removeToolFromToolbar(['copy', 'share'], 'share')).toEqual(['copy']);
    expect(removeToolFromToolbar(['copy'], 'share')).toEqual(['copy']);
  });

  test('reorderToolbar moves a tool to another tool position', () => {
    expect(reorderToolbar(['copy', 'highlight', 'search'], 'search', 'copy')).toEqual([
      'search',
      'copy',
      'highlight',
    ]);
    expect(reorderToolbar(['copy', 'search'], 'copy', 'copy')).toEqual(['copy', 'search']);
  });
});

describe('supportsProofread', () => {
  // Proofread rewrites the rendered text through the content transformers, so
  // it works on every reflowable format -- not just EPUB, which is all the
  // original feature (#2725) shipped with and all the toolbar button allowed.
  test('enables every reflowable format', () => {
    for (const format of ['EPUB', 'MD', 'MOBI', 'AZW', 'AZW3', 'FB2', 'FBZ', 'TXT'] as const) {
      expect(supportsProofread(format)).toBe(true);
    }
  });

  test('excludes the fixed-layout formats, which have no text to transform', () => {
    expect(supportsProofread('PDF')).toBe(false);
    expect(supportsProofread('CBZ')).toBe(false);
  });

  test('excludes a book whose format is not known yet', () => {
    expect(supportsProofread(undefined)).toBe(false);
  });
});
