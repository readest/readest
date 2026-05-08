import Head from 'next/head';
import { AppProps } from 'next/app';
import { EnvProvider } from '@/context/EnvContext';
import Providers from '@/components/Providers';

import '../styles/globals.css';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        {/*
         * `interactive-widget=resizes-content` makes Android Chrome
         * shrink the layout viewport when the on-screen keyboard
         * opens (matches iOS default behavior). Without it, the
         * layout viewport stays full-height and `fixed inset-0`-
         * centered modals render under the keyboard.
         */}
        <meta
          name='viewport'
          content='minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content'
        />
        <meta name='application-name' content='Readest' />
        <meta name='apple-mobile-web-app-capable' content='yes' />
        <meta name='apple-mobile-web-app-status-bar-style' content='default' />
        <meta name='apple-mobile-web-app-title' content='Readest' />
        <meta
          name='description'
          content='Readest is an open-source eBook reader supporting EPUB, PDF, and sync across devices.'
        />
        <meta name='format-detection' content='telephone=no' />
        <meta name='mobile-web-app-capable' content='yes' />
        <meta name='theme-color' content='white' />
        <link rel='manifest' href='/manifest.json' />
      </Head>
      <EnvProvider>
        <Providers>
          <Component {...pageProps} />
        </Providers>
      </EnvProvider>
    </>
  );
}

export default MyApp;
