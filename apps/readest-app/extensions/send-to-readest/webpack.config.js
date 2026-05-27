const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

// The extension SW imports `convertToEpub` from the readest-app source
// tree so all three clipping channels (desktop, mobile, extension) go
// through one EPUB pipeline and produce byte-identical output for the
// same URL. The aliases below resolve the conversion modules' internal
// `@/` paths and stub the Tauri-only deps they reach for.
const readestSrc = path.resolve(__dirname, '../../src');
const stubs = path.resolve(__dirname, 'src/stubs');

module.exports = (_env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    mode: isProd ? 'production' : 'development',
    devtool: isProd ? false : 'cheap-source-map',
    entry: {
      'background/service-worker': './src/background/service-worker.ts',
      'content/capture': './src/content/capture.ts',
      'content/auth-bridge': './src/content/auth-bridge.ts',
      'popup/popup': './src/popup/popup.ts',
      // Output the offscreen bundle flat at `dist/offscreen.js` so the
      // offscreen.html copied next to it can reference it as `offscreen.js`.
      offscreen: './src/offscreen/offscreen.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        // Stub Tauri-only deps. The conversion modules guard their use
        // behind `isTauriAppPlatform()`, which our environment stub
        // always returns false for — so these are never invoked at
        // runtime, but webpack still needs them resolvable.
        '@tauri-apps/plugin-http': path.resolve(stubs, 'tauri-http.ts'),
        // Stub the platform-detection module so the conversion code
        // takes its non-Tauri (extension SW) branches.
        '@/services/environment': path.resolve(stubs, 'environment.ts'),
        // Resolve all other `@/...` paths into the shared readest-app
        // source tree. Ordering matters — webpack alias is a prefix
        // match, so the specific `@/services/environment` stub above is
        // tried first.
        '@/services': path.resolve(readestSrc, 'services'),
        '@/utils': path.resolve(readestSrc, 'utils'),
        '@/types': path.resolve(readestSrc, 'types'),
        '@/libs': path.resolve(readestSrc, 'libs'),
        '@': readestSrc,
      },
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          // Skip *.test.ts — those are picked up by the root vitest run and
          // pull in dev-only imports (zip.js readers etc) that we don't want
          // shipped in the production bundle.
          exclude: [/node_modules/, /\.test\.ts$/],
          use: {
            loader: 'ts-loader',
            options: {
              // Don't run a full type-check inside webpack — `pnpm lint`
              // (tsgo) already covers the readest-app side. Webpack just
              // needs the JS emit. This also dodges typecheck errors
              // from un-aliased ambient types that don't ship to the
              // extension bundle.
              transpileOnly: true,
            },
          },
        },
      ],
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'popup.html', to: 'popup/popup.html' },
          { from: 'offscreen.html', to: 'offscreen.html' },
          { from: 'icons', to: 'icons', noErrorOnMissing: true },
          // `_locales/<lang>/messages.json` is Chrome's native i18n
          // surface — used for the manifest fields (extension name,
          // description, action title) and the Chrome Web Store listing.
          { from: '_locales', to: '_locales' },
        ],
      }),
    ],
    optimization: {
      // Keep the content script and service worker as single self-contained
      // files — Chrome can't load split chunks across content/service-worker
      // boundaries without extra plumbing, and the size cost is small.
      splitChunks: false,
      runtimeChunk: false,
    },
    performance: {
      // The SW bundles zip.js + Readability + DOMPurify + franc-min for
      // language detection (~400 KB minified). The content script is now
      // just lazy-load scrolling + a Port handoff (<5 KB).
      hints: false,
    },
  };
};
