import { Html, Head, Main, NextScript } from 'next/document';
import Script from 'next/script';

export default function Document() {
  return (
    <Html lang='en'>
      <Head />
      <body>
        {/* beforeInteractive must live in _document (not _app) to guarantee the
            script runs before any client-side module evaluation. */}
        <Script src='/runtime-config.js' strategy='beforeInteractive' />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
