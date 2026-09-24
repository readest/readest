import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import {
  manageDialogueHighlight,
  clearDialogueHighlight,
  refreshViewDialogueHighlight,
  DIALOGUE_SPAN_CLASS,
  DIALOGUE_BLOCK_CLASS,
} from '@/utils/dialogueHighlight';
import { getStyles, ThemeCode } from '@/utils/style';
import { BookNote, BookSearchResult, ViewSettings } from '@/types/book';
import type { FoliateView } from '@/types/view';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_WORD_LENS_CONFIG,
  DEFAULT_VIEW_SETTINGS_CONFIG,
} from '@/services/constants';

const makeViewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_WORD_LENS_CONFIG,
    ...DEFAULT_VIEW_SETTINGS_CONFIG,
    ...overrides,
  }) as ViewSettings;

const makeDoc = (bodyHtml: string): Document => {
  const doc = document.implementation.createHTMLDocument('section');
  doc.body.innerHTML = bodyHtml;
  return doc;
};

const themeCode: ThemeCode = {
  bg: '#ffffff',
  fg: '#111111',
  primary: '#0066cc',
  isDarkMode: false,
  palette: {
    'base-100': '#ffffff',
    'base-200': '#f0f0f0',
    'base-300': '#e0e0e0',
    'base-content': '#111111',
    neutral: '#808080',
    'neutral-content': '#ffffff',
    primary: '#0066cc',
    secondary: '#6699cc',
    accent: '#33cc99',
  },
} as ThemeCode;

describe('dialogueHighlight default', () => {
  it('is off by default', () => {
    expect(DEFAULT_BOOK_STYLE.dialogueHighlight).toBe(false);
  });

  it('has custom-color fields defaulting to theme-following', () => {
    expect(DEFAULT_BOOK_STYLE.dialogueHighlightCustomColor).toBe(false);
    expect(typeof DEFAULT_BOOK_STYLE.dialogueHighlightColor).toBe('string');
    expect(DEFAULT_BOOK_STYLE.dialogueHighlightCustomTextColor).toBe(false);
    expect(DEFAULT_BOOK_STYLE.dialogueHighlightTextColor).toBe('');
  });
});

describe('getStyles dialogue chunk', () => {
  it('emits no dialogue rules when disabled', () => {
    const css = getStyles(makeViewSettings({ dialogueHighlight: false }), themeCode);
    expect(css).not.toContain('.readest-dialogue');
  });

  it('tints dialogue with the theme primary color when enabled', () => {
    const css = getStyles(makeViewSettings({ dialogueHighlight: true }), themeCode);
    expect(css).toContain('.readest-dialogue');
    expect(css).toContain('#0066cc');
  });

  it('uses the custom color when the custom switch is on', () => {
    const css = getStyles(
      makeViewSettings({
        dialogueHighlight: true,
        dialogueHighlightCustomColor: true,
        dialogueHighlightColor: '#ff0000',
      }),
      themeCode,
    );
    const rules = css.match(/\.readest-dialogue(-block)?\s*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.join('\n')).toContain('#ff0000');
    expect(rules.join('\n')).not.toContain('#0066cc');
  });

  it('falls back to the theme color when custom is off or empty', () => {
    const off = getStyles(
      makeViewSettings({
        dialogueHighlight: true,
        dialogueHighlightCustomColor: false,
        dialogueHighlightColor: '#ff0000',
      }),
      themeCode,
    );
    expect(off).toContain('#0066cc');
    expect(off).not.toContain('#ff0000');

    const empty = getStyles(
      makeViewSettings({
        dialogueHighlight: true,
        dialogueHighlightCustomColor: true,
        dialogueHighlightColor: '',
      }),
      themeCode,
    );
    expect(empty).toContain('#0066cc');
  });

  it('emits text-only rules when the background is off but text custom is on', () => {
    const css = getStyles(
      makeViewSettings({
        dialogueHighlight: false,
        dialogueHighlightCustomTextColor: true,
        dialogueHighlightTextColor: '#112233',
      }),
      themeCode,
    );
    const rules = css.match(/\.readest-dialogue(-block)?\s*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBe(2);
    expect(rules.join('\n')).toContain('\n    color: #112233 !important');
    expect(rules.join('\n')).not.toContain('background-color');
  });

  it('overrides the text color only when its own switch is on and set', () => {
    const base = { dialogueHighlight: true } as Partial<ViewSettings>;
    const rulesOf = (css: string) =>
      (css.match(/\.readest-dialogue(-block)?\s*\{[^}]*\}/g) ?? []).join('\n');

    const without = rulesOf(getStyles(makeViewSettings(base), themeCode));
    expect(without).not.toContain('\n    color:');

    const custom = rulesOf(
      getStyles(
        makeViewSettings({
          ...base,
          dialogueHighlightCustomTextColor: true,
          dialogueHighlightTextColor: '#112233',
        }),
        themeCode,
      ),
    );
    expect(custom.match(/\n\s+color: #112233 !important/g)?.length).toBe(2);

    // background custom on its own must not touch the text color
    const bgOnly = rulesOf(
      getStyles(
        makeViewSettings({
          ...base,
          dialogueHighlightCustomColor: true,
          dialogueHighlightColor: '#ff0000',
        }),
        themeCode,
      ),
    );
    expect(bgOnly).not.toContain('\n    color:');

    // text switch off: a stored text color must not leak through
    const off = rulesOf(
      getStyles(
        makeViewSettings({
          ...base,
          dialogueHighlightCustomTextColor: false,
          dialogueHighlightTextColor: '#112233',
        }),
        themeCode,
      ),
    );
    expect(off).not.toContain('\n    color:');
  });
});

describe('manageDialogueHighlight', () => {
  it('wraps Chinese quoted speech', () => {
    const doc = makeDoc(`<p>他说：“你好，世界。”然后走了。</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`);
    expect(spans.length).toBe(1);
    expect(spans[0]?.textContent).toBe('“你好，世界。”');
  });

  it('wraps ASCII and Japanese/French quotes', () => {
    const doc = makeDoc(
      `<p>She said "hello there" loudly.</p><p>彼は「おはよう」と言った。</p><p>Il dit « bonjour ».</p>`,
    );
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(3);
  });

  it('wraps German low-high quotes', () => {
    const doc = makeDoc(`<p>Er sagte „guten Morgen“ und ging.</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`);
    expect(spans.length).toBe(1);
    expect(spans[0]?.textContent).toBe('„guten Morgen“');
  });

  it('marks spans CFI-transparent', () => {
    const doc = makeDoc(`<p>他说：“你好。”</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`);
    expect(spans.length).toBe(1);
    expect(spans[0]?.getAttribute('cfi-skip')).toBe('');
  });

  it('wraps sections when only the text switch is on', () => {
    const doc = makeDoc(`<p>他说：“你好。”</p>`);
    manageDialogueHighlight(
      doc,
      makeViewSettings({ dialogueHighlight: false, dialogueHighlightCustomTextColor: true }),
    );
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(1);
  });

  it('wraps dialogue broken by a newline inside one paragraph', () => {
    const doc = makeDoc(`<p>他说：“第一行\n第二行。”然后走了。</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`);
    expect(spans.length).toBe(1);
    expect(spans[0]?.textContent).toBe('“第一行\n第二行。”');
    expect(doc.querySelector('p')?.textContent).toBe('他说：“第一行\n第二行。”然后走了。');
  });

  it('wraps dialogue broken by a <br> line break', () => {
    const doc = makeDoc(`<p>他说：“第一行<br>第二行。”然后走了。</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`);
    expect(spans.length).toBe(2);
    expect(doc.querySelector('p')?.textContent).toBe('他说：“第一行第二行。”然后走了。');
  });

  it('wraps dialogue spanning inline markup', () => {
    const doc = makeDoc(`<p>他说：“<b>加粗</b>台词。”然后走了。</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`);
    expect(spans.length).toBe(3);
    expect(doc.querySelector('p')?.textContent).toBe('他说：“加粗台词。”然后走了。');
  });

  it('wraps dialogue spanning two paragraphs', () => {
    const doc = makeDoc(`<p>“第一段还没说完……</p><p>……第二段说完了。”</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const paras = doc.querySelectorAll('p');
    expect(paras[0]?.textContent).toBe('“第一段还没说完……');
    expect(paras[1]?.textContent).toBe('……第二段说完了。”');
    expect(paras[0]?.querySelector(`.${DIALOGUE_SPAN_CLASS}`)?.textContent).toBe(
      '“第一段还没说完……',
    );
    expect(paras[1]?.querySelector(`.${DIALOGUE_SPAN_CLASS}`)?.textContent).toBe(
      '……第二段说完了。”',
    );
  });

  it('does nothing when disabled and clears on toggle-off', () => {
    const doc = makeDoc(`<p>他说：“你好。”</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: false }));
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(0);

    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(1);

    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: false }));
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(0);
    // unwrapped text is restored verbatim
    expect(doc.querySelector('p')?.textContent).toBe('他说：“你好。”');
  });

  it('leaves code blocks alone', () => {
    const doc = makeDoc(`<pre>const s = "not dialogue";</pre>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(0);
  });

  it('ignores ASCII apostrophes', () => {
    const doc = makeDoc(`<p>don't stop believin'</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(0);
  });

  it('marks dash-led dialogue paragraphs without touching chapter divs', () => {
    const doc = makeDoc(`<div><p>— Bonjour, dit-il.</p><p>Narration without dash.</p></div>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const blocks = doc.querySelectorAll(`.${DIALOGUE_BLOCK_CLASS}`);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.tagName.toLowerCase()).toBe('p');
    expect(doc.querySelector('div')?.classList.contains(DIALOGUE_BLOCK_CLASS)).toBe(false);
  });

  it('marks only the innermost dash-led block', () => {
    const doc = makeDoc(`<blockquote><p>— Hello.</p><p>— World.</p></blockquote>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const blocks = doc.querySelectorAll(`.${DIALOGUE_BLOCK_CLASS}`);
    expect(blocks.length).toBe(2);
    expect(doc.querySelector('blockquote')?.classList.contains(DIALOGUE_BLOCK_CLASS)).toBe(false);
  });

  it('clearDialogueHighlight preserves nested ruby markup', () => {
    const doc = makeDoc(`<p>他说：“<ruby>加粗<rt>jia cu</rt></ruby>台词。”</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    // Gloss text (<rt>) is skipped by the scan, so the ruby stays intact.
    expect(doc.querySelector('p ruby rt')?.textContent).toBe('jia cu');
    expect(doc.querySelector('p ruby rt .readest-dialogue')).toBeNull();
    clearDialogueHighlight(doc);
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(0);
    // The ruby element survives instead of being flattened into plain text.
    expect(doc.querySelector('p ruby rt')?.textContent).toBe('jia cu');
    expect(doc.querySelector('p')?.textContent).toBe('他说：“加粗jia cu台词。”');
  });

  it('clearDialogueHighlight restores blocks', () => {
    const doc = makeDoc(`<p>— Hello.</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    expect(doc.querySelectorAll(`.${DIALOGUE_BLOCK_CLASS}`).length).toBe(1);
    clearDialogueHighlight(doc);
    expect(doc.querySelectorAll(`.${DIALOGUE_BLOCK_CLASS}`).length).toBe(0);
  });

  it('is idempotent across repeated runs', () => {
    const doc = makeDoc(`<p>他说：“重复。”她说：“也重复。”</p>`);
    const vs = makeViewSettings({ dialogueHighlight: true });
    manageDialogueHighlight(doc, vs);
    manageDialogueHighlight(doc, vs);
    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`).length).toBe(2);
  });

  it('keeps a curly apostrophe inside single-quoted dialogue', () => {
    const doc = makeDoc(`<p>‘I don’t know,’ she said. ‘It’s fine.’</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = [...doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`)].map((s) => s.textContent);
    expect(spans).toEqual(['‘I don’t know,’', '‘It’s fine.’']);
  });

  it('does not pair a stray ASCII quote with one in a later paragraph', () => {
    const doc = makeDoc(`<p>The 5" screen was small.</p><p>He said "hi" and left.</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const spans = [...doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`)].map((s) => s.textContent);
    expect(spans).toEqual(['"hi"']);
  });

  it('wraps many quotes across many text nodes', () => {
    const html = Array.from({ length: 50 }, (_, i) => `<p>A “x${i}<b>y</b>z” b “w”.</p>`).join('');
    const doc = makeDoc(html);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const paras = doc.querySelectorAll('p');
    expect(paras).toHaveLength(50);
    paras.forEach((p, i) => {
      const spans = [...p.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`)].map((s) => s.textContent);
      expect(spans).toEqual([`“x${i}`, 'y', 'z”', '“w”']);
    });
  });

  it('does not treat a hyphen-led paragraph as a dialogue line', () => {
    const doc = makeDoc(`<p>- first item</p><p>– Bonjour.</p>`);
    manageDialogueHighlight(doc, makeViewSettings({ dialogueHighlight: true }));
    const blocks = [...doc.querySelectorAll(`.${DIALOGUE_BLOCK_CLASS}`)].map((b) => b.textContent);
    expect(blocks).toEqual(['– Bonjour.']);
  });
});

describe('dialogue styles', () => {
  it('adds no horizontal padding, so toggling does not reflow the page', () => {
    const css = getStyles(makeViewSettings({ dialogueHighlight: true }), themeCode);
    const rules = (css.match(/\.readest-dialogue(-block)?\s*\{[^}]*\}/g) ?? []).join('\n');
    expect(rules).not.toContain('padding');
  });
});

describe('refreshViewDialogueHighlight', () => {
  it('rewraps every rendered section and redraws its highlights', () => {
    const doc = makeDoc(`<p>He said “hello”.</p>`);
    const addAnnotation = vi.fn();
    const view = {
      renderer: { getContents: () => [{ doc, index: 3 }] },
      addAnnotation,
    } as unknown as FoliateView;
    const note = (id: string, cfi: string, extra: Partial<BookNote> = {}) =>
      ({ id, type: 'annotation', cfi, style: 'highlight', ...extra }) as BookNote;
    const inSection = note('a', 'epubcfi(/6/8!/4/2/1:0)');
    const booknotes = [
      inSection,
      note('b', 'epubcfi(/6/10!/4/2/1:0)'),
      note('c', 'epubcfi(/6/8!/4/2/1:2)', { deletedAt: 1 }),
      note('d', 'epubcfi(/6/8!/4/2/1:4)', { type: 'bookmark' }),
    ];

    refreshViewDialogueHighlight(view, makeViewSettings({ dialogueHighlight: true }), booknotes);

    expect(doc.querySelectorAll(`.${DIALOGUE_SPAN_CLASS}`)).toHaveLength(1);
    expect(addAnnotation).toHaveBeenCalledTimes(1);
    expect(addAnnotation).toHaveBeenCalledWith(inSection);
  });

  it('redraws the search highlights in the rendered sections', () => {
    const doc = makeDoc(`<p>He said “hello”.</p>`);
    const addAnnotation = vi.fn();
    const view = {
      renderer: { getContents: () => [{ doc, index: 3 }] },
      addAnnotation,
    } as unknown as FoliateView;
    const searchResults = [
      {
        index: 3,
        label: '',
        subitems: [
          { cfi: 'epubcfi(/6/8!/4/2/1:0)', excerpt: {} },
          { cfi: 'epubcfi(/6/8!/4/2,/1:0,/1:3)', cfis: ['epubcfi(/6/8!/4/2/1:5)'], excerpt: {} },
        ],
      },
      { index: 4, label: '', subitems: [{ cfi: 'epubcfi(/6/10!/4/2/1:0)', excerpt: {} }] },
    ] as unknown as BookSearchResult[];

    refreshViewDialogueHighlight(
      view,
      makeViewSettings({ dialogueHighlight: true }),
      [],
      searchResults,
    );

    expect(addAnnotation.mock.calls.map(([note]) => note.value)).toEqual([
      'foliate-search:epubcfi(/6/8!/4/2/1:0)',
      'foliate-search:epubcfi(/6/8!/4/2/1:5)',
    ]);
  });
});
