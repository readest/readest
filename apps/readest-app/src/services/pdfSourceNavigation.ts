import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

import { isTauriAppPlatform } from '@/services/environment';
import type { FoliateView } from '@/types/view';

export const PDF_SOURCE_LOCATION_EVENT = 'pdf-source-location-requested';

export interface PdfSourceTarget {
  bookKey: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface PdfSourceLocationMessage {
  type: typeof PDF_SOURCE_LOCATION_EVENT;
  target: PdfSourceTarget;
}

export const isPdfSourceTarget = (value: unknown): value is PdfSourceTarget => {
  if (!value || typeof value !== 'object') return false;
  const target = value as Partial<PdfSourceTarget>;
  return (
    typeof target.bookKey === 'string' &&
    Number.isInteger(target.page) &&
    target.page! > 0 &&
    [target.x, target.y, target.width, target.height, target.depth].every(
      (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
    )
  );
};

export const isPdfSourceLocationMessage = (value: unknown): value is PdfSourceLocationMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<PdfSourceLocationMessage>;
  return message.type === PDF_SOURCE_LOCATION_EVENT && isPdfSourceTarget(message.target);
};

export const sendPdfSourceTarget = async (
  readerWindowLabel: string,
  target: PdfSourceTarget,
): Promise<void> => {
  if (isTauriAppPlatform()) {
    const readerWindow = await WebviewWindow.getByLabel(readerWindowLabel);
    if (!readerWindow) throw new Error('原 PDF 阅读窗口已关闭。');
    await readerWindow.emit(PDF_SOURCE_LOCATION_EVENT, target);
    await readerWindow.show();
    await readerWindow.unminimize();
    await readerWindow.setFocus();
    return;
  }

  if (!window.opener || window.opener.closed) throw new Error('原 PDF 阅读窗口已关闭。');
  const message: PdfSourceLocationMessage = { type: PDF_SOURCE_LOCATION_EVENT, target };
  window.opener.postMessage(message, window.location.origin);
  window.opener.focus();
};

const waitForPdfDocument = async (
  view: FoliateView,
  pageIndex: number,
): Promise<Document | null> => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const content = view.renderer
      .getContents()
      .find(({ doc, index }) => index === pageIndex && doc.querySelector('#canvas canvas'));
    if (content) return content.doc;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
};

const viewportDimensions = (doc: Document) => {
  const content = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;
  const width = Number(content?.match(/(?:^|,)\s*width=([\d.]+)/)?.[1]);
  const height = Number(content?.match(/(?:^|,)\s*height=([\d.]+)/)?.[1]);
  return width > 0 && height > 0 ? { width, height } : null;
};

export const showPdfSourceTarget = async (
  view: FoliateView,
  target: PdfSourceTarget,
): Promise<boolean> => {
  const pageIndex = target.page - 1;
  await view.goTo(pageIndex);
  const doc = await waitForPdfDocument(view, pageIndex);
  const viewport = doc ? viewportDimensions(doc) : null;
  const canvas = doc?.querySelector<HTMLCanvasElement>('#canvas canvas');
  if (!doc || !viewport || !canvas) return false;

  doc.querySelector('[data-testid="pdf-source-target"]')?.remove();
  const marker = doc.createElement('div');
  marker.dataset['testid'] = 'pdf-source-target';
  marker.dataset['page'] = String(target.page);
  marker.setAttribute('aria-hidden', 'true');

  const scaleX = canvas.clientWidth / viewport.width;
  const scaleY = canvas.clientHeight / viewport.height;
  const left = Math.min(canvas.clientWidth, Math.max(0, target.x * scaleX));
  const top = Math.min(
    canvas.clientHeight,
    Math.max(0, (target.y - Math.max(target.height, 0)) * scaleY),
  );
  const width = Math.max(18, Math.min(canvas.clientWidth - left, Math.abs(target.width) * scaleX));
  const height = Math.max(
    12,
    Math.min(
      canvas.clientHeight - top,
      (Math.max(target.height, 0) + Math.max(target.depth, 0)) * scaleY,
    ),
  );
  Object.assign(marker.style, {
    position: 'absolute',
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
    border: '2px solid #f59e0b',
    background: 'rgba(245, 158, 11, 0.18)',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    zIndex: '10',
  });
  doc.body.append(marker);
  setTimeout(() => marker.remove(), 4000);
  return true;
};
