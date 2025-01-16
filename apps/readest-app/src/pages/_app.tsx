import { AppProps } from 'next/app';
import Head from 'next/head';
import Providers from '@/components/Providers';

import '../styles/globals.css';
import '../styles/fonts.css';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no'
        />
      </Head>
      <Providers>
        <Component {...pageProps} />
      </Providers>
    </>
  );
}

export default MyApp;
