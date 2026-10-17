import { startPluginWorkerServer } from '@/services/plugins/workerServer';
import { TesseractOcrEngine } from './tesseractEngine';

let engine: TesseractOcrEngine | undefined;
let configuration: string | undefined;
let reportProgress: ((status: string, progress: number) => void) | undefined;
let pending: Promise<unknown> = Promise.resolve();

startPluginWorkerServer(self, {
  recognize: ({ image, page, options }, context) => {
    // Cancellation settles the caller immediately. Serialize worker jobs too,
    // so an inference finishing after cancellation cannot overlap the next page.
    const run = pending.then(async () => {
      try {
        context.signal.throwIfAborted();
        const key = JSON.stringify(options);
        if (configuration !== key) {
          await engine?.terminate();
          engine = new TesseractOcrEngine({
            ...options,
            onProgress: ({ status, progress }) => reportProgress?.(status, progress),
          });
          configuration = key;
        }
        reportProgress = (status, progress) => context.progress(status, progress, 1);
        const source =
          typeof image === 'string' ? image : new OffscreenCanvas(image.width, image.height);
        if (typeof source !== 'string' && typeof image !== 'string') {
          const canvasContext = source.getContext('2d');
          if (!canvasContext) throw new Error('OCR could not read the page image');
          canvasContext.drawImage(image, 0, 0);
          image.close();
        }
        return await engine!.recognize(source, page, context.signal);
      } finally {
        reportProgress = undefined;
        if (typeof image !== 'string') image.close();
      }
    });
    pending = run.catch(() => undefined);
    return run;
  },
});
