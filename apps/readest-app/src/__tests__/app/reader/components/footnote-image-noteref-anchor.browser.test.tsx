import { afterEach, describe, expect, test } from 'vitest';
import { getPosition, type Rect } from '@/utils/sel';

/**
 * A vertical EPUB can mark a noteref with `<a><img class="zstb"></a>`. The
 * inline anchor's client rect carries an inline-box pad and is wider than the
 * visible image; pointing the footnote triangle at the anchor's right edge
 * put it inside the popup, where `Popup` hid it (#8031). `getPosition` must
 * accept a Range over the image so the caller can use the image's own rect.
 */
describe('image noteref anchor in a vertical iframe', () => {
  let frame: HTMLIFrameElement;

  afterEach(() => {
    frame?.remove();
  });

  test('the image range measures the marker, not the padded inline anchor', () => {
    frame = document.createElement('iframe');
    frame.style.cssText =
      'position:fixed;left:40px;top:40px;width:400px;height:300px;border:0;transform:matrix(1, 0, 0, 1, 0, 0);';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.body.style.cssText =
      'margin:0;padding-right:300px;writing-mode:vertical-rl;font-size:28px;';
    doc.body.innerHTML =
      '<div style="height:240px">本旨。<a id="noteref"><img style="width:0.6rem" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZ0AAAAASUVORK5CYII="></a></div>';
    const anchor = doc.getElementById('noteref')!;
    const image = anchor.querySelector('img')!;
    const range = doc.createRange();
    range.selectNode(image);

    const frameRect = frame.getBoundingClientRect();
    const bounds: Rect = {
      left: frameRect.left,
      top: frameRect.top,
      right: frameRect.right,
      bottom: frameRect.bottom,
    };
    const fromElement = getPosition(anchor, bounds, 10, true);
    const fromRange = getPosition(range, bounds, 10, true);
    // getFrameTransform adds the iframe offset, getPosition subtracts the
    // cell's (frame) left, so the image's iframe-local rect + 6 is expected.
    const imageRight = image.getBoundingClientRect().right + 6;

    expect(fromElement.dir).toBe(fromRange.dir);
    // The element's inline-box pad is ~13px at this font size; the range
    // selects only the image, so its anchor starts left of the padded one.
    expect(fromElement.point.x).toBeGreaterThan(fromRange.point.x + 5);
    expect(fromRange.point.x).toBeCloseTo(imageRight, 0);
  });
});
