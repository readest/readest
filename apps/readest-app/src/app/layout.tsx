import * as React from 'react';
import type { Metadata, Viewport } from 'next';
import { ViewTransitions } from 'next-view-transitions';
import { EnvProvider } from '@/context/EnvContext';
import Providers from '@/components/Providers';

import '../styles/globals.css';

const url = 'https://web.readest.com/';
const title = 'Readest — Where You Read, Digest and Get Insight';
const description =
  'Discover Readest, the ultimate online ebook reader for immersive and organized reading. ' +
  'Enjoy seamless access to your digital library, powerful tools for highlighting, bookmarking, ' +
  'and note-taking, and support for multiple book views. ' +
  'Perfect for deep reading, analysis, and understanding. Explore now!';
const previewImage = 'https://cdn.readest.com/images/open_graph_preview_read_now.png';

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: title,
    template: '%s | Readest',
  },
  description,
  generator: 'Next.js',
  manifest: '/manifest.json',
  keywords: ['epub', 'pdf', 'ebook', 'reader', 'readest', 'pwa'],
  authors: [
    {
      name: 'readest',
      url: 'https://github.com/readest/readest',
    },
  ],
  icons: {
    icon: [{ url: '/icon.png' }, { url: '/favicon.ico' }],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Readest',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    url,
    title,
    description,
    images: [previewImage],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [previewImage],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'twitter:domain': 'web.readest.com',
    'twitter:url': url,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // Make Android Chrome's layout viewport shrink when the on-screen
  // keyboard opens (matches iOS behavior). Without this, Android's
  // default `interactive-widget=resizes-visual` keeps the layout
  // viewport at full screen height while only the visual viewport
  // shrinks — causing fixed `inset-0`-centered modals (passphrase
  // prompt, group picker, etc.) to render under the keyboard. With
  // `resizes-content`, `100vh` / flex centering naturally targets
  // the available space above the keyboard.
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang='en'
      className={process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri' ? 'edge-to-edge' : ''}
    >
      <body>
        <ViewTransitions>
          <EnvProvider>
            <Providers>{children}</Providers>
          </EnvProvider>
        </ViewTransitions>
      </body>
    </html>
  );
}
