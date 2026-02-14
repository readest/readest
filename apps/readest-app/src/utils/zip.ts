export const configureZip = async () => {
  const { configure } = await import('@zip.js/zip.js');
  configure({ useWebWorkers: false, useCompressionStream: false });
};
