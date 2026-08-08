// Render a store-panel caption to a transparent PNG using the app's own Inter webfont.
// Usage: node render-caption.mjs <out.png> <width> <fontPx> <weight> "line one\nline two"
import pw from '/Users/chrox/dev/readest/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.js';
import { readFileSync } from 'node:fs';
const { chromium } = pw;

const [out, wArg, sizeArg, weightArg, text, lhArg] = process.argv.slice(2);
const width = Number(wArg);
const fontPx = Number(sizeArg);
const weight = Number(weightArg);
const lineHeight = lhArg ? Number(lhArg) : 1.22;

const woff2 = readFileSync('/Users/chrox/dev/readest/apps/readest-app/public/fonts/InterVariable.woff2').toString('base64');

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face {
  font-family: 'Inter';
  src: url(data:font/woff2;base64,${woff2}) format('woff2');
  font-weight: 100 900;
}
html,body { margin:0; padding:0; background:transparent; }
#cap {
  width:${width}px;
  font-family:'Inter';
  font-weight:${weight};
  font-size:${fontPx}px;
  line-height:${lineHeight};
  /* tight line-height shrinks the box below the last line's descender, and we
     screenshot the element - pad so glyphs are never clipped, then trim. */
  padding:0.35em 0;
  letter-spacing:-0.02em;
  color:#0A0909;
  text-align:center;
  white-space:pre-line;
  font-feature-settings:'kern' 1,'liga' 1,'calt' 1;
  -webkit-font-smoothing:antialiased;
}
</style><div id="cap">${text.replace(/</g, '&lt;')}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const el = await page.$('#cap');
await el.screenshot({ path: out, omitBackground: true });
const box = await el.boundingBox();
console.log(`rendered ${out} ${Math.round(box.width)}x${Math.round(box.height)} weight=${weight} size=${fontPx}`);
await browser.close();
