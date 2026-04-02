import path from 'node:path';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vinext()],
  resolve: {
    alias: {
      '@pdfjs': path.resolve('public/vendor/pdfjs'),
      '@simplecc': path.resolve('public/vendor/simplecc'),
    },
  },
  build: {
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.message?.includes("Can't resolve original location of error")) return;
        defaultHandler(warning);
      },
    },
  },
  ssr: {
    noExternal: ['tinycolor2'],
  },
});
