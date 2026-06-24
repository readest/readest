export interface Frame {
  top: number;
  left: number;
}

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Point {
  x: number;
  y: number;
}

export type PositionDir = 'up' | 'down' | 'left' | 'right';

export interface Position {
  point: Point;
  dir?: PositionDir;
}

export interface TextSelection {
  key: string;
  text: string;
  page: number;
  range: Range;
  index: number;
  cfi?: string;
  href?: string;
  annotated?: boolean;
  rect?: Rect;
  // Native Android selection handles were suppressed for this selection
  // (Blink hyphen bounds bug, issue #1553) — the app draws its own handles.
  handlesSuppressed?: boolean;
}

const frameRect = (frame: Frame, rect?: Rect, sx = 1, sy = 1) => {
  if (!rect) return { left: 0, right: 0, top: 0, bottom: 0 };
  const left = sx * rect.left + frame.left;
  const right = sx * rect.right + frame.left;
  const top = sy * rect.top + frame.top;
  const bottom = sy * rect.bottom + frame.top;
  return { left, right, top, bottom };
};

const pointIsInView = ({ x, y }: Point) =>
  x > 0 && y > 0 && x < window.innerWidth && y < window.innerHeight;

const getIframeElement = (nodeElement: Range | Element): HTMLIFrameElement | null => {
  let node: Node | null;
  if (nodeElement && typeof nodeElement === 'object' && 'tagName' in nodeElement) {
    node = nodeElement as Element;
  } else if (nodeElement && typeof nodeElement === 'object' && 'collapse' in nodeElement) {
    node = nodeElement.commonAncestorContainer;
  } else {
    node = nodeElement;
  }
  while (node) {
    if (node.nodeType === Node.DOCUMENT_NODE) {
      const doc = node as Document;
      if (doc.defaultView && doc.defaultView.frameElement) {
        return doc.defaultView.frameElement as HTMLIFrameElement;
      }
    }
    node = node.parentNode;
  }

  return null;
};

const constrainPointWithinRect = (point: Point, rect: Rect, padding: number) => {
  return {
    x: Math.max(padding, Math.min(point.x, rect.right - rect.left - padding)),
    y: Math.max(padding, Math.min(point.y, rect.bottom - rect.top - padding)),
  };
};

export const isPointInRect = (point: Point, rect: Rect, padding: number = 1): boolean => {
  return (
    point.x >= rect.left + padding &&
    point.x <= rect.right - padding &&
    point.y >= rect.top + padding &&
    point.y <= rect.bottom - padding
  );
};

/**
 * Resolve the bounding rect of a {@link Range} in the OUTER webview's
 * viewport coordinate system (CSS pixels, top-down).
 *
 * Foliate renders book pages inside an iframe with a CSS transform
 * (its column-pagination layout uses non-identity `matrix(...)` to
 * shift columns). A naive `range.getBoundingClientRect()` returns
 * coordinates in the iframe's local viewport, which won't line up
 * with anything outside the iframe. This helper applies the iframe's
 * transform scale and offset, mirroring the math in {@link getPosition}.
 *
 * Returns `null` when the range is detached (no iframe ancestor) or
 * has no client rects (collapsed / off-screen).
 */
export const getRangeRectInWebview = (range: Range): Rect | null => {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const frameElement = getIframeElement(range);
  // No iframe ancestor — range lives directly in the host document
  // (e.g. fixed-layout PDF). Pass through the rect as-is.
  if (!frameElement) {
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
  }
  const transform = getComputedStyle(frameElement).transform;
  const match = transform.match(/matrix\((.+)\)/);
  const [sx, , , sy] = match?.[1]?.split(/\s*,\s*/)?.map((x) => parseFloat(x)) ?? [];
  const scaleX = Number.isFinite(sx) ? sx! : 1;
  const scaleY = Number.isFinite(sy) ? sy! : 1;
  const frame = frameElement.getBoundingClientRect();
  return {
    top: scaleY * rect.top + frame.top,
    bottom: scaleY * rect.bottom + frame.top,
    left: scaleX * rect.left + frame.left,
    right: scaleX * rect.right + frame.left,
  };
};

/**
 * Sample the visual style (font size / family / color) of the text
 * underneath a {@link Range}. Used by the macOS system-dictionary
 * bridge so the inline HUD label matches the original paragraph's
 * typography — `-[NSView showDefinitionForAttributedString:atPoint:]`
 * re-draws the word using whatever attributes we hand in, and a plain
 * unattributed string falls back to AppKit's small system font.
 *
 * The font-size is scaled by the iframe's vertical transform so the
 * value is in **outer webview** CSS pixels (matching what AppKit
 * receives via the contentView, which itself reports its bounds in
 * CSS pixels on standard Tauri/macOS).
 *
 * Returns `null` when the range has no element parent we can sample.
 */
export interface RangeTextStyle {
  fontSize: number;
  fontFamily: string;
  color: string;
}

export const getRangeTextStyleInWebview = (range: Range): RangeTextStyle | null => {
  const node: Node | null =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
  if (!style) return null;

  const frameElement = getIframeElement(range);
  let scaleY = 1;
  if (frameElement) {
    const transform = getComputedStyle(frameElement).transform;
    const match = transform.match(/matrix\((.+)\)/);
    const parts = match?.[1]?.split(/\s*,\s*/)?.map((x) => parseFloat(x));
    const sy = parts?.[3];
    if (Number.isFinite(sy)) scaleY = sy!;
  }

  // Cross-check the declared font-size against the range's actual
  // visual height. In typical EPUB layout the inline box is roughly
  // `font-size × line-height` tall (≈1.2× by default), so a declared
  // font-size noticeably *larger* than the rendered height means the
  // value isn't a real CSS pixel measurement we can hand to NSFont —
  // pdf.js's text layer is the canonical offender: each glyph span
  // can carry an intrinsic `font-size` that reflects the document's
  // unit-em size before `transform: scale(...)` shrinks it back to
  // page-coordinate pixels, leaving `getComputedStyle(...).fontSize`
  // many times bigger than the on-screen glyph. Without compensation
  // the macOS HUD lays out a giant attributed string and the yellow
  // highlight rectangle behind it engulfs neighbouring paragraphs.
  //
  // Fix: when the declared size exceeds the inline box height by
  // more than 30 %, treat the inline box height as the source of
  // truth and back out a plausible font-size. 0.85 is the typical
  // ratio of cap-height-ish font-size to a 1.2 line-height box; it
  // matches normal EPUB body text (the common case) within a few
  // percent and converges PDF text layers onto something AppKit can
  // render at a sensible scale. Below the threshold (the common
  // EPUB case) we leave the declared value alone.
  const declaredFontSize = (parseFloat(style.fontSize) || 0) * scaleY;
  let fontSize = declaredFontSize;
  const renderedHeight = range.getBoundingClientRect().height;
  if (renderedHeight > 0 && declaredFontSize > renderedHeight * 1.3) {
    fontSize = renderedHeight * 0.85;
  }

  return {
    fontSize,
    fontFamily: style.fontFamily,
    color: style.color,
  };
};

export const isPointerInsideSelection = (selection: Selection, ev: PointerEvent) => {
  if (selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const padding = 50;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i]!;
    if (
      ev.clientX >= rect.left - padding &&
      ev.clientX <= rect.right + padding &&
      ev.clientY >= rect.top - padding &&
      ev.clientY <= rect.bottom + padding
    ) {
      return true;
    }
  }
  return false;
};

export const getPosition = (
  targetElement: Range | Element | TextSelection,
  rect: Rect,
  paddingPx: number,
  isVertical: boolean = false,
) => {
  const { range: target, rect: targetRect } =
    targetElement && 'range' in targetElement
      ? targetElement
      : { range: targetElement, rect: undefined };
  const frameElement = getIframeElement(target);
  const transform = frameElement ? getComputedStyle(frameElement).transform : '';
  const match = transform.match(/matrix\((.+)\)/);
  const [sx, , , sy] = match?.[1]?.split(/\s*,\s*/)?.map((x) => parseFloat(x)) ?? [];

  const frame = frameElement?.getBoundingClientRect() ?? { top: 0, left: 0 };
  let padding = { top: 0, right: 0, bottom: 0, left: 0 };
  if ('nodeType' in target && target.nodeType === 1) {
    const computedStyle = window.getComputedStyle(target);
    padding = {
      top: parseInt(computedStyle.paddingTop, 10) || 0,
      right: parseInt(computedStyle.paddingRight, 10) || 0,
      bottom: parseInt(computedStyle.paddingBottom, 10) || 0,
      left: parseInt(computedStyle.paddingLeft, 10) || 0,
    };
  }
  const rects = Array.from(target.getClientRects()).map((rect) => {
    return {
      top: rect.top + padding.top,
      right: rect.right - padding.right,
      bottom: rect.bottom - padding.bottom,
      left: rect.left + padding.left,
    };
  });
  const first = targetRect
    ? frameRect(frame, targetRect, sx, sy)
    : frameRect(frame, rects[0], sx, sy);
  const last = targetRect
    ? frameRect(frame, targetRect, sx, sy)
    : frameRect(frame, rects.at(-1), sx, sy);

  if (isVertical) {
    const leftSpace = first.left - rect.left;
    const rightSpace = rect.right - first.right;
    const dir = leftSpace > rightSpace ? 'left' : 'right';
    const position = {
      point: constrainPointWithinRect(
        {
          x: dir === 'left' ? first.left - rect.left - 6 : first.right - rect.left + 6,
          y: (first.top + first.bottom) / 2 - rect.top,
        },
        rect,
        paddingPx,
      ),
      dir,
    } as Position;
    const inView = pointIsInView(position.point);
    return inView ? position : ({ point: { x: 0, y: 0 }, dir } as Position);
  }

  const start = {
    point: constrainPointWithinRect(
      { x: (first.left + first.right) / 2 - rect.left, y: first.top - rect.top - 12 },
      rect,
      paddingPx,
    ),
    dir: 'up',
  } as Position;
  const end = {
    point: constrainPointWithinRect(
      { x: (last.left + last.right) / 2 - rect.left, y: last.bottom - rect.top + 6 },
      rect,
      paddingPx,
    ),
    dir: 'down',
  } as Position;
  // Decide which selection end is on-screen by testing its UNCLAMPED line-rect
  // midpoint against the READING FRAME (`rect`) — not the window. A cross-page
  // selection's off-screen start maps to a negative/sidebar x that is still
  // inside the window, so a window-based check would wrongly read it "in view"
  // and pin the popup off the visible page (#1354).
  const midX = (r: Rect) => (r.left + r.right) / 2;
  const midY = (r: Rect) => (r.top + r.bottom) / 2;
  const inFrame = (px: number, py: number) =>
    px > rect.left && px < rect.right && py > rect.top && py < rect.bottom;
  const startInView = inFrame(midX(first), midY(first));
  const endInView = inFrame(midX(last), midY(last));
  if (!startInView && !endInView) {
    // Multi-page selection: both ends are off the visible page, but the middle
    // may cross it. Anchor to the last on-screen line so the popup tracks the
    // visible part of the selection.
    const v = rects
      .map((r) => frameRect(frame, r, sx, sy))
      .filter((r) => inFrame(midX(r), midY(r)))
      .at(-1);
    if (v) {
      return {
        point: constrainPointWithinRect(
          { x: midX(v) - rect.left, y: v.bottom - rect.top + 6 },
          rect,
          paddingPx,
        ),
        dir: 'down',
      } as Position;
    }
    // Otherwise fall through and anchor to an end so the popup still shows
    // (the constrained points are always within the frame, never {0,0}).
  }
  if (!startInView) return end;
  if (!endInView) return start;
  return start.point.y > window.innerHeight - end.point.y ? start : end;
};

// The popup will be positioned based on the triangle position and the direction
// up: above the triangle
// down: below the triangle
// left: to the left of the triangle
// right: to the right of the triangle
export const getPopupPosition = (
  position: Position,
  boundingReact: Rect,
  popupWidthPx: number,
  popupHeightPx: number,
  popupPaddingPx: number,
) => {
  const popupPoint = { x: 0, y: 0 };
  if (position.dir === 'up') {
    popupPoint.x = position.point.x - popupWidthPx / 2;
    popupPoint.y = position.point.y - popupHeightPx;
  } else if (position.dir === 'down') {
    popupPoint.x = position.point.x - popupWidthPx / 2;
    popupPoint.y = position.point.y + 6;
  } else if (position.dir === 'left') {
    popupPoint.x = position.point.x - popupWidthPx;
    popupPoint.y = position.point.y - popupHeightPx / 2;
  } else if (position.dir === 'right') {
    popupPoint.x = position.point.x + 6;
    popupPoint.y = position.point.y - popupHeightPx / 2;
  }

  if (popupPoint.x < popupPaddingPx) {
    popupPoint.x = popupPaddingPx;
  }
  if (popupPoint.y < popupPaddingPx) {
    popupPoint.y = popupPaddingPx;
  }
  if (popupPoint.x + popupWidthPx > boundingReact.right - boundingReact.left - popupPaddingPx) {
    popupPoint.x = boundingReact.right - boundingReact.left - popupPaddingPx - popupWidthPx;
  }
  if (popupPoint.y + popupHeightPx > boundingReact.bottom - boundingReact.top - popupPaddingPx) {
    popupPoint.y = boundingReact.bottom - boundingReact.top - popupPaddingPx - popupHeightPx;
  }

  return { point: popupPoint, dir: position.dir } as Position;
};

// Standard desktop text-selection shortcuts (#4728): extend the active
// selection with the keyboard. Pure key→intent mapping so it stays testable.
//
// - Shift+←/→            → extend by character
// - Ctrl/Alt+Shift+←/→   → extend by word (Ctrl on Windows/Linux, Option on macOS)
//
// `direction` is visual ('left'/'right') so it matches the arrow key pressed and
// reads correctly in RTL text. Meta/Cmd is left alone so the browser's native
// line-boundary selection (Cmd+Shift+←/→ on macOS) still works.
export interface KeyModifiers {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface SelectionAdjustment {
  direction: 'left' | 'right';
  granularity: 'character' | 'word';
}

export const getKeyboardSelectionAdjustment = (ev: KeyModifiers): SelectionAdjustment | null => {
  if (!ev.shiftKey || ev.metaKey) return null;
  const direction = ev.key === 'ArrowLeft' ? 'left' : ev.key === 'ArrowRight' ? 'right' : null;
  if (!direction) return null;
  const granularity = ev.ctrlKey || ev.altKey ? 'word' : 'character';
  return { direction, granularity };
};

// Locate the active (non-collapsed) selection across the rendered section
// documents (foliate's `renderer.getContents()`) and, in `extend` mode, grow or
// shrink it per the keyboard adjustment (#4728). Returns whether a selection was
// found, so the caller can suppress page-turn navigation. With `extend` false it
// only reports presence — used when the iframe itself held focus and the browser
// already extended the selection natively.
export const extendSelectionFromContents = (
  contents: { doc: Document }[],
  ev: KeyModifiers,
  extend: boolean,
): boolean => {
  const adjustment = getKeyboardSelectionAdjustment(ev);
  if (!adjustment) return false;
  for (const { doc } of contents) {
    const sel = doc.defaultView?.getSelection();
    if (sel && !sel.isCollapsed) {
      if (extend) sel.modify('extend', adjustment.direction, adjustment.granularity);
      return true;
    }
  }
  return false;
};

export const snapRangeToWords = (range: Range): void => {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return;

  const isPunctuation = (ch: string) => /^\p{P}|\p{S}$/u.test(ch);

  const snapStartToWordBoundary = () => {
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? '';
    const offset = range.startOffset;
    if (offset === 0 || offset >= text.length) return;

    const charAtOffset = text[offset] ?? '';
    if (isPunctuation(charAtOffset)) return;

    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const seg of segmenter.segment(text)) {
      if (seg.isWordLike && seg.index < offset && seg.index + seg.segment.length > offset) {
        range.setStart(node, seg.index);
        break;
      }
    }
  };

  const snapEndToWordBoundary = () => {
    const node = range.endContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? '';
    const offset = range.endOffset;
    if (offset === 0 || offset >= text.length) return;

    const charBeforeOffset = text[offset - 1] ?? '';
    if (isPunctuation(charBeforeOffset)) return;

    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const seg of segmenter.segment(text)) {
      if (seg.isWordLike && seg.index < offset && seg.index + seg.segment.length > offset) {
        range.setEnd(node, seg.index + seg.segment.length);
        break;
      }
    }
  };

  snapStartToWordBoundary();
  snapEndToWordBoundary();
};

// --- Android hyphenation selection-bounds bug (issue #1553) -----------------
//
// Blink's `LayoutSelection::ComputePaintingSelectionStateForCursor` compares
// the selection's paragraph text-content offsets against each fragment's
// `TextOffset()`. Auto/soft-hyphen fragments are layout-generated text whose
// offsets are self-relative ({0,1}), so a touch selection starting at the
// first character of a paragraph marks EVERY hyphen fragment in it as a
// selection start: the native start handle is painted on the paragraph's last
// hyphen and drag gestures re-anchor the selection base there. The helpers
// below detect that condition so the app can repair the range and suppress
// the broken native handles (touch handles are the only consumer of the bogus
// bounds, so mouse/desktop selections are unaffected).

const isInlineDisplay = (el: Element): boolean => {
  const display = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? '';
  return display === 'inline' || display.startsWith('ruby');
};

// The element establishing the inline formatting context the range starts in.
const getBlockAncestor = (node: Node): Element | null => {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el && isInlineDisplay(el)) {
    el = el.parentElement;
  }
  return el;
};

// Whether the range starts at the first character of its paragraph's inline
// content (leading collapsed whitespace does not count: it never reaches the
// paragraph's laid-out text, so the selection still maps to offset 0).
export const isRangeStartAtBlockStart = (range: Range): boolean => {
  const block = getBlockAncestor(range.startContainer);
  if (!block) return false;
  const probe = (block.ownerDocument ?? document).createRange();
  try {
    probe.selectNodeContents(block);
    probe.setEnd(range.startContainer, range.startOffset);
  } catch {
    return false;
  }
  return probe.toString().trim().length === 0;
};

// A generated hyphen is the only way a single text node produces two adjacent
// boxes on the same line where the trailing one is sub-glyph narrow.
const HYPHEN_MAX_EM = 0.6;
const HYPHEN_ADJACENCY_PX = 2;

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const hasTrailingHyphenRectPattern = (
  rects: RectLike[],
  emPx: number,
  vertical: boolean,
): boolean => {
  for (let i = 1; i < rects.length; i++) {
    const a = rects[i - 1]!;
    const b = rects[i]!;
    const sameLine = vertical
      ? Math.abs(a.left - b.left) < Math.max(a.width, b.width) / 2
      : Math.abs(a.top - b.top) < Math.max(a.height, b.height) / 2;
    if (!sameLine) continue;
    const adjacent = vertical
      ? Math.abs(b.top - (a.top + a.height)) <= HYPHEN_ADJACENCY_PX
      : Math.abs(b.left - (a.left + a.width)) <= HYPHEN_ADJACENCY_PX ||
        Math.abs(a.left - (b.left + b.width)) <= HYPHEN_ADJACENCY_PX;
    if (!adjacent) continue;
    const size = vertical ? b.height : b.width;
    if (size > 0 && size <= emPx * HYPHEN_MAX_EM) return true;
  }
  return false;
};

const blockHasGeneratedHyphens = (block: Element, vertical: boolean): boolean => {
  const doc = block.ownerDocument;
  const win = doc.defaultView;
  if (!win) return false;
  const emPx = parseFloat(win.getComputedStyle(block).fontSize) || 16;
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const probe = doc.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node as Text).data.trim()) continue;
    let rects: RectLike[];
    try {
      probe.selectNodeContents(node);
      rects = Array.from(probe.getClientRects());
    } catch {
      return false;
    }
    if (hasTrailingHyphenRectPattern(rects, emPx, vertical)) return true;
  }
  return false;
};

// Whether painting this selection hits the Blink generated-hyphen bounds bug:
// it starts at the first character of a paragraph that renders hyphens.
export const isHyphenHandleBugProneRange = (range: Range, vertical = false): boolean => {
  const block = getBlockAncestor(range.startContainer);
  if (!block) return false;
  const win = block.ownerDocument.defaultView;
  if (!win) return false;
  const style = win.getComputedStyle(block);
  const mayHyphenate =
    style.getPropertyValue('hyphens') === 'auto' ||
    style.getPropertyValue('-webkit-hyphens') === 'auto' ||
    (block.textContent ?? '').includes('­');
  if (!mayHyphenate) return false;
  if (!isRangeStartAtBlockStart(range)) return false;
  return blockHasGeneratedHyphens(block, vertical);
};

// Window-coordinate position of the selection focus (caret), or null. The book
// content lives in a (possibly very wide, multi-column) iframe translated by the
// pagination offset, so map the caret from iframe space via the iframe element's
// on-screen rect. Used by the corner auto page-turn (the caret is an engagement
// signal) and the keyboard turn-on-cross check.
export const focusCaretWindowPos = (doc: Document, sel: Selection): Point | null => {
  const focusNode = sel.focusNode;
  const win = doc.defaultView;
  if (!focusNode || !win) return null;
  let rect: DOMRect;
  try {
    const range = doc.createRange();
    const offset =
      focusNode.nodeType === Node.TEXT_NODE
        ? Math.min(sel.focusOffset, (focusNode.textContent ?? '').length)
        : sel.focusOffset;
    range.setStart(focusNode, offset);
    range.collapse(true);
    rect = range.getBoundingClientRect();
  } catch {
    return null;
  }
  // An unmeasurable range (e.g. focus on an empty element) collapses to 0,0,0,0.
  if (rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.right === 0) return null;
  const feRect = win.frameElement?.getBoundingClientRect();
  return {
    x: (rect.left + rect.right) / 2 + (feRect?.left ?? 0),
    y: (rect.top + rect.bottom) / 2 + (feRect?.top ?? 0),
  };
};

// Rebuild a selection range between a known-good anchor and the caret at a
// point (in `doc` viewport coordinates) — used to restore the range a
// corrupted long-press drag was meant to produce: anchored at the
// gesture-initial position, ending where the finger was. Snapped to word
// boundaries like the native word-granularity drag.
export const rangeFromAnchorToPoint = (
  doc: Document,
  anchorNode: Node,
  anchorOffset: number,
  x: number,
  y: number,
): Range | null => {
  let pointNode: Node | null = null;
  let pointOffset = 0;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      pointNode = pos.offsetNode;
      pointOffset = pos.offset;
    }
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      pointNode = range.startContainer;
      pointOffset = range.startOffset;
    }
  }
  if (!pointNode) return null;
  const range = doc.createRange();
  try {
    const anchorPoint = doc.createRange();
    anchorPoint.setStart(anchorNode, anchorOffset);
    anchorPoint.collapse(true);
    const caretPoint = doc.createRange();
    caretPoint.setStart(pointNode, pointOffset);
    caretPoint.collapse(true);
    if (anchorPoint.compareBoundaryPoints(Range.START_TO_START, caretPoint) <= 0) {
      range.setStart(anchorNode, anchorOffset);
      range.setEnd(pointNode, pointOffset);
    } else {
      range.setStart(pointNode, pointOffset);
      range.setEnd(anchorNode, anchorOffset);
    }
  } catch {
    return null;
  }
  if (range.collapsed) return null;
  snapRangeToWords(range);
  return range;
};

// During a long-press drag the bug re-anchors the selection base at the last
// hyphen, dropping the word the gesture started on. If the gesture-initial
// anchor fell out of the final range, rebuild [initial anchor → focus] (the
// focus is where the finger actually went) and snap it to word boundaries
// like the native word-granularity drag would.
export const repairJumpedSelectionRange = (
  sel: Selection,
  initialNode: Node,
  initialOffset: number,
): Range | null => {
  if (sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const { focusNode, focusOffset } = sel;
  const doc = range.startContainer.ownerDocument;
  if (!focusNode || !doc) return null;
  try {
    if (range.comparePoint(initialNode, initialOffset) === 0) return null;
  } catch {
    return null;
  }
  const repaired = doc.createRange();
  try {
    const initialPoint = doc.createRange();
    initialPoint.setStart(initialNode, initialOffset);
    initialPoint.collapse(true);
    const focusPoint = doc.createRange();
    focusPoint.setStart(focusNode, focusOffset);
    focusPoint.collapse(true);
    if (initialPoint.compareBoundaryPoints(Range.START_TO_START, focusPoint) <= 0) {
      repaired.setStart(initialNode, initialOffset);
      repaired.setEnd(focusNode, focusOffset);
    } else {
      repaired.setStart(focusNode, focusOffset);
      repaired.setEnd(initialNode, initialOffset);
    }
  } catch {
    return null;
  }
  if (repaired.collapsed) return null;
  snapRangeToWords(repaired);
  return repaired;
};

export const getTextFromRange = (range: Range, rejectTags: string[] = []): string => {
  const clonedRange = range.cloneRange();
  const fragment = clonedRange.cloneContents();
  const walker = document.createTreeWalker(
    fragment,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (rejectTags.includes(parent?.tagName.toLowerCase() || '')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  // pdf.js inserts <br role="presentation"> between text spans at line endings
  // (see TextLayer#appendText in pdfjs). Without this, multi-line PDF
  // selections collapse adjacent line-final and line-initial words into a
  // single token (e.g. "lastfirst"). Treat <br> as a newline, matching how
  // Selection.toString() handles line breaks in the browser.
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node as Text).nodeValue ?? '';
    } else if ((node as Element).tagName === 'BR') {
      text += '\n';
    }
  }

  return text;
};
