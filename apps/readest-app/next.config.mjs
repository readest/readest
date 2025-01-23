import withPWA from 'next-pwa';

const appPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure Next.js uses SSG instead of SSR
  // https://nextjs.org/docs/pages/building-your-application/deploying/static-exports
  output: appPlatform === 'web' ? undefined : 'export',
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  devIndicators: {
    appIsrStatus: false,
  },
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: '',
  reactStrictMode: true,
};

export default withPWA({
  dest: 'public',
  disable: appPlatform !== 'web',
  register: true,
  skipWaiting: true,
})(nextConfig);
