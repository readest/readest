import withBundleAnalyzer from '@next/bundle-analyzer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env['NODE_ENV'] === 'development';
const appPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

const exportOutput = appPlatform !== 'web' && !isDev;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure Next.js uses SSG instead of SSR
  // https://nextjs.org/docs/pages/building-your-application/deploying/static-exports
  output: exportOutput ? 'export' : undefined,
  pageExtensions: exportOutput ? ['jsx', 'tsx'] : ['js', 'jsx', 'ts', 'tsx'],
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  experimental: {
    // Persist Turbopack's compilation cache to `.next/` so CI can restore it
    // between runs. Dev caching is on by default since Next 16.1; build
    // caching is opt-in (beta).
    turbopackFileSystemCacheForDev: true,
    turbopackFileSystemCacheForBuild: false,
  },
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: '',
  reactStrictMode: true,
  serverExternalPackages: ['isows'],
  allowedDevOrigins: ['192.168.2.120'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      nunjucks: 'nunjucks/browser/nunjucks.js',
      // `js-mdict` is consumed as TS source via tsconfig paths from
      // `packages/js-mdict/src/`; its sources `import 'fflate'` directly.
      // Without an alias, webpack walks up from that source location and
      // can't find fflate (only installed in this app's node_modules).
      fflate: path.resolve(__dirname, 'node_modules/fflate'),
      ...(appPlatform !== 'web' ? { '@tursodatabase/database-wasm': false } : {}),
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      nunjucks: 'nunjucks/browser/nunjucks.js',
      // Turbopack rejects absolute paths in resolveAlias ("server relative
      // imports not implemented") — use a project-relative path.
      fflate: './node_modules/fflate',
      ...(appPlatform !== 'web' ? { '@tursodatabase/database-wasm': './src/utils/stub.ts' } : {}),
    },
  },
  transpilePackages: [
    ...(isDev
      ? []
      : [
          'i18next-browser-languagedetector',
          'react-i18next',
          'i18next',
          '@tauri-apps',
          'highlight.js',
          'foliate-js',
          'marked',
        ]),
  ],
};

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withAnalyzer(nextConfig);
