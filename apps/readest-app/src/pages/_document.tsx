import { Html, Head, Main, NextScript } from 'next/document';
import Script from 'next/script';
import { getServerConfigBootstrapScript } from '@/services/serverConfig';

// Only the web/Docker build serves `/runtime-config.js`. See app/layout.tsx.
const shouldInjectRuntimeConfig = process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';
// Tauri's runtime server choice. See app/layout.tsx.
const shouldInjectServerConfig = process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';

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
        {shouldInjectServerConfig ? (
          <script dangerouslySetInnerHTML={{ __html: getServerConfigBootstrapScript() }} />
        ) : null}
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
