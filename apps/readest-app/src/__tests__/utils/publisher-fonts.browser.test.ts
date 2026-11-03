// "Ignore publisher font names" (#7276): a book list such as
// `Palatino, serif` names fonts ahead of the generic, so the reader's serif
// font was never reached. With the category's switch on, the list resolves to
// the reader's font; with it off, the book's list renders as before.
import { afterEach, describe, expect, it } from 'vitest';
import { getStyles, transformStylesheet } from '@/utils/style';
import { styleTransformer } from '@/services/transformers/style';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';
import type { ViewSettings } from '@/types/book';
import type { TransformContext } from '@/services/transformers/types';

const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
});

const BOOK_CSS = `
  body { font-family: serif; }
  #serif { font-family: PublisherSerif, "Publisher Two", serif !important; }
  #sans { font: italic 20px/1.5 PublisherSans, sans-serif; }
  #mono { font-family: PublisherMono, monospace; }
  #decorative { font-family: Decorative, fantasy; }
`;

const BODY =
  '<p id="serif">a</p><p id="sans">b</p><p id="mono">c</p><p id="decorative">d</p>' +
  '<p id="inline" style="font-family: &quot;Inline Serif&quot;, serif">e</p>' +
  '<p id="inline-font" style=\'font: bold 1em "Inline Sans", sans-serif\'>f</p>' +
  '<p id="plain">g</p>';

const render = async () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const doc = frame.contentDocument!;
  const book = doc.createElement('style');
  // Transformed twice: a stylesheet can pass through the transform again (#5277).
  book.textContent = transformStylesheet(
    transformStylesheet(BOOK_CSS, 800, 600, false),
    800,
    600,
    false,
  );
  doc.head.append(book);
  doc.body.innerHTML = await styleTransformer.transform({
    bookKey: 'book',
    viewSettings: { vertical: false } as ViewSettings,
    userLocale: 'en',
    isFixedLayout: false,
    width: 800,
    height: 600,
    content: BODY,
    transformers: ['style'],
  } satisfies TransformContext);
  const reader = doc.createElement('style');
  doc.head.append(reader);
  const apply = (settings: Partial<ViewSettings>) => {
    reader.textContent = getStyles({
      ...DEFAULT_BOOK_FONT,
      ...DEFAULT_BOOK_LAYOUT,
      ...DEFAULT_BOOK_STYLE,
      ...DEFAULT_VIEW_CONFIG,
      serifFont: 'ReaderSerif',
      sansSerifFont: 'ReaderSans',
      monospaceFont: 'ReaderMono',
      ...settings,
    } as ViewSettings);
  };
  const style = (id: string) => frame.contentWindow!.getComputedStyle(doc.getElementById(id)!);
  const font = (id: string) => style(id).fontFamily;
  return { apply, font, style };
};

const IDS = ['serif', 'sans', 'mono', 'decorative', 'inline', 'inline-font', 'plain'];

describe('Ignore publisher font names', () => {
  it('keeps the book fonts while every switch is off', async () => {
    const { apply, font } = await render();
    apply({});
    expect(font('serif')).toMatch(/^PublisherSerif, "Publisher Two", /);
    expect(font('sans')).toMatch(/^PublisherSans, sans-serif$/);
    expect(font('mono')).toMatch(/^PublisherMono, /);
    expect(font('inline')).toMatch(/^"Inline Serif", serif$/);
    expect(font('inline-font')).toMatch(/^"Inline Sans", sans-serif$/);
  });

  it('swaps only the switched categories for the reader font, live', async () => {
    const { apply, font } = await render();
    apply({ ignorePublisherFonts: ['serif'] });
    expect(font('serif')).toMatch(/^ReaderSerif,/);
    expect(font('inline')).toMatch(/^ReaderSerif,/);
    expect(font('sans')).toMatch(/^PublisherSans/);
    expect(font('mono')).toMatch(/^PublisherMono/);

    apply({ ignorePublisherFonts: ['sans-serif', 'monospace'] });
    expect(font('serif')).toMatch(/^PublisherSerif/);
    expect(font('sans')).toMatch(/^ReaderSans,/);
    expect(font('inline-font')).toMatch(/^ReaderSans,/);
    expect(font('mono')).toMatch(/^ReaderMono,/);
    expect(font('decorative')).toBe('Decorative, fantasy');

    apply({});
    expect(font('sans')).toMatch(/^PublisherSans/);
    expect(font('mono')).toMatch(/^PublisherMono/);
  });

  it('keeps the rest of a font shorthand', async () => {
    const { apply, style } = await render();
    apply({ ignorePublisherFonts: ['sans-serif'] });
    expect(style('sans').fontStyle).toBe('italic');
    expect(style('sans').fontSize).toBe('20px');
    expect(style('sans').lineHeight).toBe('30px');
    expect(style('inline-font').fontWeight).toBe('700');
  });

  it('leaves Override Book Font in charge', async () => {
    const { apply, font } = await render();
    apply({ overrideFont: true });
    const baseline = IDS.map(font);
    apply({ overrideFont: true, ignorePublisherFonts: ['serif', 'sans-serif', 'monospace'] });
    expect(IDS.map(font)).toEqual(baseline);
  });
});
