import { describe, expect, it } from 'vitest';
import { createTextBookFile, getTextTitle } from '@/utils/txt';

describe('getTextTitle', () => {
  it('uses the first non-empty line', () => {
    expect(getTextTitle('\n\n  Morning briefing  \nBody text')).toBe('Morning briefing');
  });

  it('caps long first lines', () => {
    expect(getTextTitle('x'.repeat(200))).toHaveLength(80);
  });
});

describe('createTextBookFile', () => {
  it('names the file after the given title and keeps the text as is', async () => {
    const file = createTextBookFile('First line\nSecond line', 'Notes / News', 'Pasted Text');
    expect(file.name).toBe('Notes - News.txt');
    expect(file.type).toBe('text/plain');
    expect(await file.text()).toBe('First line\nSecond line');
  });

  it('falls back to the first line when the title is blank', () => {
    const file = createTextBookFile('\nGemini: 3 things to know\n\nMore', '  ', 'Pasted Text');
    expect(file.name).toBe('Gemini - 3 things to know.txt');
  });

  it('falls back to the fallback title when nothing usable is left', () => {
    expect(createTextBookFile('...', '', 'Pasted Text').name).toBe('Pasted Text.txt');
  });
});
