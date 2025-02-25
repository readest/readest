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
  range: Range;
  index: number;
  href?: string;
  annotated?: boolean;
}

const frameRect = (frame: Frame, rect: Rect, sx = 1, sy = 1) => {
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
    x: Math.max(padding, Math.min(point.x, rect.right - padding)),
    y: Math.max(padding, Math.min(point.y, rect.bottom - padding)),
  };
};

export const getPosition = (
  target: Range | Element,
  rect: Rect,
  paddingPx: number,
  isVertical: boolean = false,
) => {
  const frameElement = getIframeElement(target);
  const transform = frameElement ? getComputedStyle(frameElement).transform : '';
  const match = transform.match(/matrix\((.+)\)/);
  const [sx, , , sy] = match?.[1]?.split(/\s*,\s*/)?.map((x) => parseFloat(x)) ?? [];

  const frame = frameElement?.getBoundingClientRect() ?? { top: 0, left: 0 };
  const rects = Array.from(target.getClientRects());
  const first = frameRect(frame, rects[0] as Rect, sx, sy);
  const last = frameRect(frame, rects.at(-1) as Rect, sx, sy);

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
    point: { x: (first.left + first.right) / 2 - rect.left, y: first.top - rect.top - 12 },
    dir: 'up',
  } as Position;
  const end = {
    point: { x: (last.left + last.right) / 2 - rect.left, y: last.bottom - rect.top + 6 },
    dir: 'down',
  } as Position;
  const startInView = pointIsInView(start.point);
  const endInView = pointIsInView(end.point);
  if (!startInView && !endInView) return { point: { x: 0, y: 0 } };
  if (!startInView) return end;
  if (!endInView) return start;
  return start.point.y > window.innerHeight - end.point.y ? start : end;
};

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
