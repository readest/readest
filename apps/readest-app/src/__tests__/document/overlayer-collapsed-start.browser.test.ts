import { describe, it, expect, afterEach } from 'vitest';
import { Overlayer } from 'foliate-js/overlayer.js';

// readest/readest#7800: a note whose text starts at an inline element
// (`？<b>“恻隐之心”</b>…`) can be anchored at the very end of the text node
// before it. Splitting that range per text node left a collapsed piece whose
// zero-width rect sits right after the previous sentence, and the note bubble
// is drawn at the first rect, so it landed on the previous note's bubble.

let container: HTMLDivElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

const setup = (html: string) => {
  container = document.createElement('div');
  Object.assign(container.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '600px',
    font: '20px/30px sans-serif',
  });
  container.innerHTML = html;
  document.body.append(container);
  const overlayer = new Overlayer(document);
  container.append(overlayer.element);
  const p = container.querySelector('p')!;
  const bold = p.querySelector('b')!;
  const before = p.firstChild as Text;
  const after = bold.nextSibling as Text;
  return { overlayer, p, bold, before, after };
};

// Overlayer.bubble (size 20, padding 10) draws from 10px left of and 10px
// above the top-right corner of the range's first rect.
const bubbleAnchor = (g: Element) => {
  const { x, y } = (g.firstElementChild as SVGGraphicsElement).getBBox();
  return { x: x + 10, y: y + 10 };
};

const bubbles = (overlayer: Overlayer) =>
  Array.from((overlayer.element as SVGSVGElement).querySelectorAll(':scope > g'));

describe('Overlayer: a range that starts at the end of a text node (#7800)', () => {
  it('puts the note bubble at the note text, not on the previous note', () => {
    const { overlayer, p, bold, before, after } = setup(
      '<p>Lead in. First note ends here.<b>Second</b> note goes on.</p>',
    );
    const first = document.createRange();
    first.setStart(before, 'Lead in. '.length);
    first.setEnd(before, before.length);
    const second = document.createRange();
    second.setStart(before, before.length);
    second.setEnd(after, after.length);

    overlayer.add('first', first, Overlayer.bubble);
    overlayer.add('second', second, Overlayer.bubble);

    expect(p.getClientRects()).toHaveLength(1);
    const [a, b] = bubbles(overlayer).map(bubbleAnchor);
    const boldRect = bold.getBoundingClientRect();
    expect(b!.x).toBeCloseTo(boldRect.right, 1);
    expect(b!.y).toBeCloseTo(boldRect.top, 1);
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(20);
  });

  it('draws nothing on the line before for a range starting after a line break', () => {
    const { overlayer, bold, before, after } = setup(
      '<p>First note ends here.<br><b>Second</b> note goes on.</p>',
    );
    const range = document.createRange();
    range.setStart(before, before.length);
    range.setEnd(after, after.length);

    overlayer.add('bubble', range, Overlayer.bubble);
    overlayer.add('highlight', range, Overlayer.highlight);

    const [bubble, highlight] = bubbles(overlayer);
    const boldRect = bold.getBoundingClientRect();
    expect(bubbleAnchor(bubble!).y).toBeCloseTo(boldRect.top, 1);
    // One strip for the one line of text, and no sliver after "here."
    expect(highlight!.children).toHaveLength(1);
    expect(highlight!.getBoundingClientRect().top).toBeGreaterThanOrEqual(boldRect.top - 1);
  });
});
