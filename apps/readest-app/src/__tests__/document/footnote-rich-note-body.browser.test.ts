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
// Foliate's strict `check` validation rejects any extracted note body with
// more than three element children ("Failed to locate footnote content"),
// even though the extraction is exactly right. The rejection falls back to
// jumping the main view to the note instead of showing the popup, and the
// orphaned popup view then renders the whole section. Readest must therefore
// not ask for strict validation for a superscript marker, which already
// confirms the reference on its own.
const SECTION_BODY = `
  <p class="c22"><strong>Title</strong></p>
  <p class="c23"><strong>The Author</strong></p>
  <p class="c24">DVD 6.3 (42:01)</p>
  <p class="c25">Lorem ipsum kañ sit amet, <i>kañ</i> God elit, sed do eiusmod tempor incididunt ut something et dolore magna aliqua. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. In the name of God, ut labore et magna aliqua. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do Qāf tempor incididunt ut labore et dolore magna <em>aliqua</em><a id="id_11"></a><a href="#id_12"><sup>1</sup></a> also. Lorem ipsum dolor sit amet, consectetur adipiscing <em>elit</em>.”</p>
  <hr/>
  <p class="p4"><a href="#id_11"></a><a id="id_12">1.</a><em> Lorem</em> ipsum <em>kañ</em> eiusmod tempor incididunt ut something et <em>aliqua</em>, eiusmod tempor incididunt ut something et <em>dolore</em> (aliqua). See <em>Lorem ipsum, kañ sit amet</em>, (16.113-115).</p>
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

const getRefAnchor = () => {
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head></head><body>${SECTION_BODY}</body></html>`,
    'text/html',
  );
  return doc.querySelector('a[href="#id_12"]') as HTMLAnchorElement;
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

  it('shows only the note when no strict check is requested', async () => {
    const { handled, rendered } = await openPopup({
      a: getRefAnchor(),
      href: 'Section0001.html#id_12',
    });
    await handled;
    const view = await rendered;
    const text = view.renderer.getContents()[0]!.doc.body.textContent!;
    expect(text).toContain('See Lorem ipsum, kañ sit amet, (16.113-115).');
    expect(text).not.toContain('The Author');
    expect(text).not.toContain('DVD 6.3');
  });

  it('rejects the same note when strict check is requested (why readest gates it)', async () => {
    const { handled } = await openPopup({
      a: getRefAnchor(),
      href: 'Section0001.html#id_12',
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
});
