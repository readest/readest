import withPWAInit from '@ducanh2912/next-pwa';
import withBundleAnalyzer from '@next/bundle-analyzer';

const isDev = process.env['NODE_ENV'] === 'development';
const appPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

if (isDev) {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
}

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
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: '',
  reactStrictMode: true,
  serverExternalPackages: ['isows'],
  turbopack: {},
  transpilePackages: !isDev
    ? [
        'i18next-browser-languagedetector',
        'react-i18next',
        'i18next',
        '@ducanh2912/next-pwa',
        '@tauri-apps',
        'highlight.js',
        'foliate-js',
        'marked',
      ]
    : [],
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

const withPWA = withPWAInit({
  dest: 'public',
  disable: isDev || appPlatform !== 'web',
  cacheStartUrl: false,
  dynamicStartUrl: false,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  fallbacks: {
    document: '/offline',
  },
  workboxOptions: {
    disableDevLogs: true,
    manifestTransforms: [
      (manifestEntries) => {
        const manifest = manifestEntries.filter((entry) => {
          const url = entry.url;
          return (
            !url.includes('dynamic-css-manifest.json') &&
            !url.includes('middleware-manifest.json') &&
            !url.includes('react-loadable-manifest.json') &&
            !url.includes('build-manifest.json') &&
            !url.includes('_buildManifest.js') &&
            !url.includes('_ssgManifest.js') &&
            !url.includes('_headers')
          );
        });
        return { manifest };
      },
    ],
  },
});

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withPWA(withAnalyzer(nextConfig));
