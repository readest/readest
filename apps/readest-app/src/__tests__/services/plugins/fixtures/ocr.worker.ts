import { startPluginWorkerServer } from '@/services/plugins/workerServer';

startPluginWorkerServer(self, {
  recognize: async ({ image, page }, { signal, progress }) => {
    if (typeof image === 'string') throw new Error('Expected a transferred image');
    try {
      const canvas = new OffscreenCanvas(page.width, page.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      progress('recognizing text', 0, 1);
      if (page.pageIndex === 1) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, 1000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeout);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      }
      progress('recognizing text', 1, 1);
      return {
        ...page,
        blocks: [
          {
            id: 'sample',
            text: String(context.getImageData(0, 0, 1, 1).data[0]),
            box: { xMin: 0, yMin: 0, xMax: page.width, yMax: page.height },
            writingMode: 'vertical-rl',
          },
        ],
      };
    } finally {
      image.close();
    }
  },
});
