import { afterEach, describe, expect, test } from 'vitest';
import { bindInlineEventHandlers } from '@/utils/inlineEventHandlers';

// The app's CSP refuses a book's inline event handlers, so the reader binds
// them itself once the section has loaded (#7769). The markup is from a Go
// book whose diagrams show replay controls when tapped.
const loadSection = (body: string) => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const win = frame.contentWindow as unknown as Record<string, unknown>;
  win['calls'] = [];
  win['record'] = (what: string, self: unknown) => (win['calls'] as unknown[]).push([what, self]);
  doc.body.innerHTML = body;
  return { doc, win, calls: win['calls'] as unknown[][] };
};

// What the CSP leaves behind: the attribute is there, its handler is null.
// (jsdom itself runs inline handlers.)
const refuseInlineHandlers = (doc: Document) => {
  for (const el of doc.querySelectorAll('*')) {
    for (const { name } of Array.from(el.attributes)) {
      if (name.startsWith('on') && name in el) (el as unknown as Record<string, null>)[name] = null;
    }
  }
};

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

describe('bindInlineEventHandlers', () => {
  test("runs the section body's onload once, after the section has loaded", () => {
    const { doc, calls } = loadSection('<p id="epub-check">no scripting</p>');
    doc.body.setAttribute('onload', "record('onload', this)");
    refuseInlineHandlers(doc);

    bindInlineEventHandlers(doc);

    expect(calls.map(([what]) => what)).toEqual(['onload']);
  });

  test('leaves handlers the webview already runs alone', () => {
    const { doc, calls } = loadSection('<p onclick="record(\'click\', this)">text</p>');
    doc.body.setAttribute('onload', "record('onload', this)");

    bindInlineEventHandlers(doc);
    doc.querySelector('p')!.click();

    expect(calls.map(([what]) => what)).toEqual(['click']);
  });

  test('a malformed handler is skipped and later ones still bind', () => {
    const { doc, calls } = loadSection(
      '<p id="bad" onclick="if (">bad</p><p id="good" onclick="record(\'good\', this)">good</p>',
    );
    refuseInlineHandlers(doc);

    expect(() => bindInlineEventHandlers(doc)).not.toThrow();
    doc.getElementById('good')!.click();

    expect(calls.map(([what]) => what)).toEqual(['good']);
  });

  test("a throwing body onload runs once and doesn't throw into the reader", () => {
    const { doc, calls } = loadSection('<p>text</p>');
    doc.body.setAttribute('onload', "record('onload', this); throw new Error('book failure')");
    refuseInlineHandlers(doc);

    expect(() => bindInlineEventHandlers(doc)).not.toThrow();
    expect(calls.map(([what]) => what)).toEqual(['onload']);
  });

  test('a tap runs the inline handler once, on its element, and return false cancels it', () => {
    const { doc, calls } = loadSection(
      '<svg><rect width="10" height="10" onmousedown="record(\'down\', this); return false;" onclick="return false;"></rect></svg>',
    );
    const rect = doc.querySelector('rect')!;
    refuseInlineHandlers(doc);

    bindInlineEventHandlers(doc);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    rect.dispatchEvent(down);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    rect.dispatchEvent(click);

    expect(calls).toEqual([['down', rect]]);
    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
  });
});
