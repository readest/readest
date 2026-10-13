import path from 'node:path';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vinext()],
  resolve: {
    alias: {
      // pdfjs-dist itself, not a copy under `public/`: a module the bundler
      // imports must not be published too, or Tauri embeds it twice (#6368).
      '@pdfjs': path.resolve('../../packages/foliate-js/node_modules/pdfjs-dist/legacy/build'),
      '@simplecc': path.resolve('../../packages/simplecc-wasm/dist/web'),
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
