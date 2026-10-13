import type { InkPoint } from './model';
import type { PageRect } from './coords';
import {
  queryPenCapabilities,
  startRawDrawing,
  stopRawDrawing,
  type PenStrokeBatch,
} from '@/utils/bridge';

export type BooxBatchListener = (points: InkPoint[], kind: 'move' | 'end', erase: boolean) => void;

/**
 * BOOX raw-drawing backend. The SDK paints the stroke on the e-ink panel
 * while the pen moves, then hands the whole stroke over on pen-up; region,
 * points and widths cross the bridge in CSS px.
 */
export class BooxHandwritingBackend {
  private toPage: ((x: number, y: number) => InkPoint) | null = null;
  private listener: BooxBatchListener | null = null;
  private unlisten: (() => void) | null = null;

  onBatch(listener: BooxBatchListener) {
    this.listener = listener;
  }

  async start(
    region: PageRect,
    toPage: (x: number, y: number) => InkPoint,
    strokeWidth: number,
    strokeColor: string,
  ) {
    this.toPage = toPage;
    if (!this.unlisten) {
      const { addPluginListener } = await import('@tauri-apps/api/core');
      const handle = await addPluginListener<PenStrokeBatch>(
        'native-bridge',
        'pen-stroke-batch',
        (batch) => this.handleBatch(batch),
      );
      this.unlisten = () => void handle.unregister();
    }
    await startRawDrawing({ ...region, strokeWidth, strokeColor });
  }

  /** Re-issue the session with a new region or pen; a no-op when stopped. */
  async update(region: PageRect, strokeWidth: number, strokeColor: string) {
    if (!this.unlisten) return;
    await startRawDrawing({ ...region, strokeWidth, strokeColor });
  }

  async stop() {
    this.unlisten?.();
    this.unlisten = null;
    this.toPage = null;
    await stopRawDrawing();
  }

  private handleBatch(batch: PenStrokeBatch) {
    const toPage = this.toPage;
    if (!toPage) return;
    const points = batch.points.map((p): InkPoint => {
      const [x, y] = toPage(p.x, p.y);
      return p.pressure > 0 ? [x, y, p.pressure] : [x, y];
    });
    const kind = batch.kind === 'DRAW_END' || batch.kind === 'ERASE_END' ? 'end' : 'move';
    const erase = batch.kind === 'ERASE_MOVE' || batch.kind === 'ERASE_END';
    this.listener?.(points, kind, erase);
  }
}

export { queryPenCapabilities };
