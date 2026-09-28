import Polyfills from '../polyfills';
import * as React from 'react';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ViewTransitions } from '@/components/ViewTransitions';
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
  // `interactive-widget=resizes-content` is appended client-side on
  // Android only — see Providers.tsx. Other browsers warn about the
  // unrecognized key on every page load, so we keep it out of SSR.
};

// In Tauri mobile dev the page origin doesn't match the dev server, so
// Next.js's `getSocketUrl` builds an unreachable HMR URL (see
// `next/dist/client/dev/hot-reloader/get-socket-url.js`):
//   - iOS sim:        page at `tauri://localhost`        → `wss://localhost/_next/...`
//     (no port, non-http scheme falls through to `wss:`)
//   - Android emul.:  page at `http://tauri.localhost`   → `ws://tauri.localhost/_next/...`
//     (`tauri.localhost` is intercepted by Tauri's asset handler, but
//     WebSocket frames bypass the interceptor and the dev server is on the
//     host machine, reachable from the emulator as `10.0.2.2`)
// Rewrite the WebSocket constructor before the HMR client runs.
// When `--host <ip>` is passed, tauri-cli exports `TAURI_DEV_HOST=<ip>`
// before invoking `beforeDevCommand`, so we forward that as `devHost` and
// use it for the rewrite (the dev server must also bind to the same address
// — typically `next dev -H 0.0.0.0`).
function patchTauriHmrWebSocket(devHost?: string) {
  const isIosTauriProxy = location.protocol === 'tauri:' && location.hostname === 'localhost';
  const isAndroidTauriProxy =
    location.protocol === 'http:' && location.hostname === 'tauri.localhost';
  if (!isIosTauriProxy && !isAndroidTauriProxy) return;

  // Priority: explicit --host > platform default loopback alias.
  // iOS Simulator can reach the host's localhost directly.
  // Android emulator reaches the host machine via 10.0.2.2.
  const hmrHost = devHost
    ? `${devHost}:3000`
    : isIosTauriProxy
      ? 'localhost:3000'
      : '10.0.2.2:3000';
  const brokenHostPattern = /^wss?:\/\/(localhost|tauri\.localhost)(?=\/_next\/)/;

  const OriginalWebSocket = window.WebSocket;
  class PatchedWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = url instanceof URL ? url.href : url;
      const rewritten =
        typeof urlStr === 'string' && brokenHostPattern.test(urlStr)
          ? urlStr.replace(brokenHostPattern, `ws://${hmrHost}`)
          : url;
      super(rewritten, protocols);
    }
  }
  window.WebSocket = PatchedWebSocket;
}

const shouldInjectDevHmrPatch =
  process.env['NODE_ENV'] === 'development' && process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';
const devHmrPatchScript = `(${patchTauriHmrWebSocket.toString()})(${JSON.stringify(
  process.env['TAURI_DEV_HOST'],
)});`;

// `/runtime-config.js` is a dynamic route handler that only exists in the
// web/Docker build. The Tauri build is statically exported (`output:
// 'export'`), so the file isn't emitted — the request would return the SPA
// fallback HTML and crash with `Unexpected token '<'`. All runtime-config
// consumers fall back to `NEXT_PUBLIC_*` envs baked at build time on Tauri.
const shouldInjectRuntimeConfig = process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';

// WebKit APIs the bundled chunks call that ship in Safari 17.4/17.5
// (macOS 14.4/14.5). On macOS ≤ 14.3 the missing functions throw as soon as
// an async chunk evaluates, crashing the app to a blank window before the
// <Polyfills /> client module gets a chance to run. This inline script sits
// at the top of <head>, so the parser executes it before any chunk script
// element even exists. Feature-detected: a no-op on current browsers.
const webkitCompatPolyfillScript = `(function(){
if(typeof Promise.withResolvers!=="function"){Promise.withResolvers=function(){var resolve,reject;var promise=new Promise(function(res,rej){resolve=res;reject=rej});return{promise:promise,resolve:resolve,reject:reject}}}
if(typeof Promise.try!=="function"){Promise.try=function(handler){var args=Array.prototype.slice.call(arguments,1);return new Promise(function(resolve){resolve(handler.apply(null,args))})}}
if(typeof Object.groupBy!=="function"){Object.groupBy=function(iterable,callback){var groups=Object.create(null);var index=0;for(var _i=0,_a=iterable;_i<_a.length;_i++){var value=_a[_i];var key=String(callback(value,index++)).replace("-0","0");(groups[key]||(groups[key]=[])).push(value)}return groups}}
if(typeof Map.groupBy!=="function"){Map.groupBy=function(iterable,callback){var groups=new Map();var index=0;for(var _i=0,_a=iterable;_i<_a.length;_i++){var value=_a[_i];var key=callback(value,index++);var bucket=groups.get(key);if(bucket)bucket.push(value);else groups.set(key,[value])}return groups}}
function asSet(v){return v instanceof Set?v:new Set(v)}
if(typeof Set.prototype.union!=="function"){Set.prototype.union=function(other){var r=new Set(this);for(var _i=0,_a=asSet(other);_i<_a.length;_i++){var item=_a[_i];r.add(item)}return r}}
if(typeof Set.prototype.intersection!=="function"){Set.prototype.intersection=function(other){var r=new Set();var o=asSet(other);for(var _i=0,_a=this;_i<_a.length;_i++){var item=_a[_i];if(o.has(item))r.add(item)}return r}}
if(typeof Set.prototype.difference!=="function"){Set.prototype.difference=function(other){var r=new Set();var o=asSet(other);for(var _i=0,_a=this;_i<_a.length;_i++){var item=_a[_i];if(!o.has(item))r.add(item)}return r}}
if(typeof Set.prototype.symmetricDifference!=="function"){Set.prototype.symmetricDifference=function(other){var r=new Set(this);for(var _i=0,_a=asSet(other);_i<_a.length;_i++){var item=_a[_i];if(r.has(item))r.delete(item);else r.add(item)}return r}}
if(typeof Set.prototype.isSubsetOf!=="function"){Set.prototype.isSubsetOf=function(other){var o=asSet(other);for(var _i=0,_a=this;_i<_a.length;_i++){var item=_a[_i];if(!o.has(item))return false}return true}}
if(typeof Set.prototype.isSupersetOf!=="function"){Set.prototype.isSupersetOf=function(other){var o=asSet(other);for(var _i=0,_a=o;_i<_a.length;_i++){var item=_a[_i];if(!this.has(item))return false}return true}}
if(typeof Set.prototype.isDisjointFrom!=="function"){Set.prototype.isDisjointFrom=function(other){var o=asSet(other);for(var _i=0,_a=this;_i<_a.length;_i++){var item=_a[_i];if(o.has(item))return false}return true}}
if(typeof Uint8Array.fromBase64!=="function"){Uint8Array.fromBase64=function(s){s=String(s).replace(/-/g,"+").replace(/_/g,"/").replace(/\\s+/g,"");while(s.length%4)s+="=";var bin=atob(s);var out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}}
if(typeof Uint8Array.prototype.setFromBase64!=="function"){Uint8Array.prototype.setFromBase64=function(s){s=String(s).replace(/-/g,"+").replace(/_/g,"/").replace(/\\s+/g,"");while(s.length%4)s+="=";var bin=atob(s);var n=Math.min(bin.length,this.length);for(var i=0;i<n;i++)this[i]=bin.charCodeAt(i);return{read:n,written:n}}}
if(typeof Uint8Array.prototype.toBase64!=="function"){Uint8Array.prototype.toBase64=function(){var s="";for(var i=0;i<this.length;i++)s+=String.fromCharCode(this[i]);return btoa(s)}}
if(typeof Uint8Array.prototype.toHex!=="function"){Uint8Array.prototype.toHex=function(){var h="";for(var i=0;i<this.length;i++){var b=this[i].toString(16);h+=b.length<2?"0"+b:b}return h}}
if(typeof Uint8Array.prototype.setFromHex!=="function"){Uint8Array.prototype.setFromHex=function(s){var n=Math.min(Math.floor(s.length/2),this.length);for(var i=0;i<n;i++)this[i]=parseInt(s.slice(i*2,i*2+2),16);return{read:n*2,written:n}}}
if(typeof RegExp.escape!=="function"){RegExp.escape=function(s){return String(s).replace(/[.*+?\u0024\u007b()|[\\]\\\\]/g,"\\\\$&")}}
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Browser extensions can inject attributes on <html> before React hydrates it.
  return (
    <html
      lang='en'
      suppressHydrationWarning
      className={process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri' ? 'edge-to-edge' : ''}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: webkitCompatPolyfillScript }} />
        {shouldInjectRuntimeConfig ? (
          <Script src='/runtime-config.js' strategy='beforeInteractive' />
        ) : null}
        {shouldInjectDevHmrPatch ? (
          <script dangerouslySetInnerHTML={{ __html: devHmrPatchScript }} />
        ) : null}
      </head>
      <body>
        <Polyfills />
        <ViewTransitions>
          <EnvProvider>
            <Providers>{children}</Providers>
          </EnvProvider>
        </ViewTransitions>
      </body>
    </html>
  );
}
