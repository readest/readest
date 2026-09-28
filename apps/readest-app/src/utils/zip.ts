import { Configuration } from '@zip.js/zip.js';

export const configureZip = async (configuration?: Partial<Configuration>) => {
  const { configure } = await import('@zip.js/zip.js');
  configure({
    useWebWorkers: false,
    useCompressionStream: false,
    ...(configuration ? configuration : {}),
  });
};
