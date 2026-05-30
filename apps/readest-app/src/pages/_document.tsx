import { Html, Head, Main, NextScript } from 'next/document';
import Script from 'next/script';

// Only the web/Docker build serves `/runtime-config.js`. See app/layout.tsx.
const shouldInjectRuntimeConfig = process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';

export default function Document() {
  return (
    <Html lang='en'>
      <Head />
      <body>
        {/* beforeInteractive must live in _document (not _app) to guarantee the
            script runs before any client-side module evaluation. */}
        {shouldInjectRuntimeConfig ? (
          <Script src='/runtime-config.js' strategy='beforeInteractive' />
        ) : null}
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
