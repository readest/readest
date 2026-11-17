import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { FootnoteHandler } from 'foliate-js/footnotes.js';
import type { FoliateView } from '@/types/view';

// The reporter's reproduced book (#7537, Section0001.html): a footnote
// reference `<a href="#id_12"><sup>1</sup></a>` whose note body is a single
// paragraph carrying a backlink, a marker and five <em> runs — seven element
// children in all:
//
//   <p class="p4"><a href="#id_11"></a><a id="id_12">1.</a><em> Lorem</em>
//   ipsum <em>kañ</em> ... et <em>dolore</em> (aliqua). See
//   <em>Lorem ipsum, kañ sit amet</em>, (16.113-115).</p>
//
// Readest asks foliate to `check` any link whose text looks like a note
// marker, and `check` rejects a note body with more than three element
// children ("Failed to locate footnote content"). A superscript marker already
// confirms the reference, so foliate must not apply `check` to it. A bare
// numeric marker, recognised by its text alone, still earns it, and passes only
// when its note links back to the reference (foliate-js#173).
const SECTION_BODY = `
  <p class="c22"><strong>Title</strong></p>
  <p class="c23"><strong>The Author</strong></p>
  <p class="c24">DVD 6.3 (42:01)</p>
  <p class="c25">Lorem ipsum kañ sit amet, <i>kañ</i> God elit, sed do eiusmod tempor incididunt ut something et dolore magna aliqua. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. In the name of God, ut labore et magna aliqua. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do Qāf tempor incididunt ut labore et dolore magna <em>aliqua</em><a id="id_11"></a><a href="#id_12"><sup>1</sup></a> also. Lorem ipsum dolor sit amet, consectetur adipiscing <em>elit</em>.”</p>
  <p>A bare<a id="id_21"></a><a href="#id_22">2</a> numeric marker.</p>
  <p>Another bare<a href="#id_42">4</a> marker.</p>
  <hr/>
  <p class="p4"><a href="#id_11"></a><a id="id_12">1.</a><em> Lorem</em> ipsum <em>kañ</em> eiusmod tempor incididunt ut something et <em>aliqua</em>, eiusmod tempor incididunt ut something et <em>dolore</em> (aliqua). See <em>Lorem ipsum, kañ sit amet</em>, (16.113-115).</p>
  <p class="p4"><a href="#id_21"></a><a id="id_22">2.</a><em> Dolor</em> sit <em>amet</em>, <em>elit</em> and <em>tempor</em>.</p>
  <p class="p4"><a id="id_42">4.</a><em> No</em> link <em>back</em> to <em>the</em> <em>reference</em>.</p>
  <h2 id="id_30">Chapter Two</h2>
`;

const makeSection = (id: string, body: string) => {
  const content = `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  return {
    id,
    linear: 'yes',
    size: content.length,
    load: () => url,
    loadContent: () => content,
    unload: () => {},
    resolveHref: (href: string) => (href.startsWith('#') ? `${id}${href}` : href),
  };
};

const makeBook = () => ({
  dir: 'ltr',
  sections: [makeSection('Section0001.html', SECTION_BODY)],
  resolveHref: (href: string) => {
    const id = href.split('#')[1]!;
    return { index: 0, anchor: (doc: Document) => doc.getElementById(id) };
  },
});

const getRefAnchor = (id: string) => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head></head><body>${SECTION_BODY}</body></html>`,
    'text/html',
  );
  return doc.querySelector(`a[href="#${id}"]`) as HTMLAnchorElement;
};

describe('Footnote popup for a richly formatted note (#7537, browser)', () => {
  let popup: HTMLElement | undefined;

  beforeAll(async () => {
    await import('foliate-js/view.js');
  });

  afterEach(() => {
    popup?.remove();
    popup = undefined;
  });

  const openPopup = async (detail: Record<string, unknown>) => {
    const handler = new FootnoteHandler();
    handler.addEventListener('before-render', (e) => {
      popup = (e as CustomEvent<{ view: FoliateView }>).detail.view as unknown as HTMLElement;
      Object.assign(popup.style, { display: 'block', width: '400px', height: '300px' });
      document.body.append(popup);
    });
    const rendered = new Promise<FoliateView>((resolve) => {
      handler.addEventListener('render', (e) =>
        resolve((e as CustomEvent<{ view: FoliateView }>).detail.view),
      );
    });
    const event = new CustomEvent('link', { cancelable: true, detail });
    const handled = handler.handle(makeBook(), event);
    return { handler, handled, rendered };
  };

  it('shows only the note for a superscript marker, even when check is requested', async () => {
    const { handled, rendered } = await openPopup({
      a: getRefAnchor('id_12'),
      href: 'Section0001.html#id_12',
      check: true,
    });
    await handled;
    const view = await rendered;
    const text = view.renderer.getContents()[0]!.doc.body.textContent!;
    expect(text).toContain('See Lorem ipsum, kañ sit amet, (16.113-115).');
    expect(text).not.toContain('The Author');
    expect(text).not.toContain('DVD 6.3');
  });

  it('shows only the note for a bare numeric marker whose note links back to it', async () => {
    const { handled, rendered } = await openPopup({
      a: getRefAnchor('id_22'),
      href: 'Section0001.html#id_22',
      check: true,
    });
    await handled;
    const view = await rendered;
    const text = view.renderer.getContents()[0]!.doc.body.textContent!;
    expect(text.trim()).toBe('2. Dolor sit amet, elit and tempor.');
  });

  it('still rejects a rich note that does not link back to a bare numeric marker', async () => {
    const { handled } = await openPopup({
      a: getRefAnchor('id_42'),
      href: 'Section0001.html#id_42',
      check: true,
    });
    let error: unknown;
    try {
      await handled;
    } catch (e) {
      error = e;
    }
    expect((error as Error)?.message).toContain('Failed to locate footnote content');
  });

  // `vertical-align: 0` computes to `0px`, which is the baseline, not a
  // superscript: a numeric link set that way still earns the strict check.
  it('still rejects a link to a heading for a numeric marker aligned at 0px', async () => {
    const holder = document.createElement('p');
    holder.innerHTML = 'See part<a href="#id_30" style="vertical-align: 0">3</a>.';
    document.body.append(holder);
    try {
      const { handled } = await openPopup({
        a: holder.querySelector('a')!,
        href: 'Section0001.html#id_30',
        check: true,
      });
      await expect(handled).rejects.toThrow('Failed to locate footnote content');
    } finally {
      holder.remove();
    }
  });
});
