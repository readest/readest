import type { InkPoint } from './model';
import {
  queryPenCapabilities,
  setRawDrawingEnabled,
  startRawDrawing,
  stopRawDrawing,
  type PenStrokeBatch,
} from '@/utils/bridge';

export type BooxBatchListener = (points: InkPoint[], kind: 'move' | 'end', erase: boolean) => void;

/**
 * BOOX raw-drawing backend. The only TS file that mentions "raw drawing" —
 * everything else in the reader talks to HandwritingService, which picks
 * this backend or PointerHandwritingBackend based on capabilities and
 * treats them identically once started.
 */
export class BooxHandwritingBackend {
  private toPage: ((x: number, y: number) => InkPoint) | null = null;
  private listener: BooxBatchListener | null = null;
  private unlisten: (() => void) | null = null;
  private region: { left: number; top: number; width: number; height: number } | null = null;

  onBatch(listener: BooxBatchListener) {
    this.listener = listener;
  }

  async start(
    region: { left: number; top: number; width: number; height: number },
    toPage: (x: number, y: number) => InkPoint,
    strokeWidthPx: number,
    strokeColor: string,
  ) {
    this.toPage = toPage;
    this.region = region;
    const { addPluginListener } = await import('@tauri-apps/api/core');
    const handle = await addPluginListener<PenStrokeBatch>(
      'native-bridge',
      'pen-stroke-batch',
      (batch) => this.handleBatch(batch),
    );
    this.unlisten = () => handle.unregister();
    await startRawDrawing({ ...region, strokeWidth: strokeWidthPx, strokeColor });
  }

  /**
   * The native pen takes its color and width as start-time arguments and has
   * no update command, so changing either re-issues startRawDrawing with the
   * stored region. The listener stays registered — re-registering it on every
   * color tap would leak a subscription per change.
   */
  async updatePen(strokeWidthPx: number, strokeColor: string) {
    if (!this.region) return;
    await startRawDrawing({
      ...this.region,
      strokeWidth: strokeWidthPx,
      strokeColor,
    });
  }

  setEnabled(enabled: boolean) {
    void setRawDrawingEnabled(enabled);
  }

  async stop() {
    this.unlisten?.();
    this.unlisten = null;
    this.toPage = null;
    this.region = null;
    await stopRawDrawing();
  }

  private handleBatch(batch: PenStrokeBatch) {
    if (!this.toPage) return;
    const points = batch.points.map((p): InkPoint => {
      const [x, y] = this.toPage!(p.x, p.y);
      return p.pressure > 0 ? [x, y, p.pressure] : [x, y];
    });
    const kind = batch.kind === 'DRAW_END' || batch.kind === 'ERASE_END' ? 'end' : 'move';
    const erase = batch.kind === 'ERASE_MOVE' || batch.kind === 'ERASE_END';
    this.listener?.(points, kind, erase);
  }
}

export { queryPenCapabilities };
