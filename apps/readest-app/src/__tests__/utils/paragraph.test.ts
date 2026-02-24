import { describe, it, expect } from 'vitest';
import { ParagraphIterator } from '@/utils/paragraph';

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

describe('ParagraphIterator', () => {
  it('skips whitespace-only paragraphs', async () => {
    const doc = createDoc(`
      <p>First</p>
      <p> </p>
      <p>&nbsp;</p>
      <p>\u200b</p>
      <p><span>\u00a0</span></p>
      <p><br /></p>
      <p>Second</p>
    `);

    const iterator = await ParagraphIterator.createAsync(doc, 1000);

    expect(iterator.length).toBe(2);
    expect(iterator.first()?.toString()).toContain('First');
    expect(iterator.next()?.toString()).toContain('Second');
  });

  it('keeps paragraphs with non-text content', async () => {
    const doc = createDoc(`
      <p>Intro</p>
      <p><img src="cover.png" alt="" /></p>
      <p>Outro</p>
    `);

    const iterator = await ParagraphIterator.createAsync(doc, 1000);

    expect(iterator.length).toBe(3);

    iterator.first();
    expect(iterator.current()?.toString()).toContain('Intro');

    const imageRange = iterator.next();
    const fragment = imageRange?.cloneContents();
    expect(fragment?.querySelector('img')).not.toBeNull();

    expect(iterator.next()?.toString()).toContain('Outro');
  });
});
