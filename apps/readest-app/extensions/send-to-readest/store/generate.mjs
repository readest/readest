#!/usr/bin/env node
/**
 * Generate Chrome Web Store screenshots for the Send to Readest extension.
 *
 * Composites the popup capture (store/popup.png) onto an on-brand background
 * (matching readest.com) with a headline, renders it with headless Chromium,
 * and writes 24-bit PNGs (no alpha) at the two Web Store sizes into store/out/.
 *
 *   pnpm store:screenshots        # from extensions/send-to-readest/
 *
 * Requires:
 *   - @playwright/test            (already a monorepo dev dependency)
 *   - ImageMagick `magick` on PATH (brew install imagemagick)
 *
 * To tweak the result, edit CONFIG below. Keep CONFIG.status.text in sync with
 * the success message in src/popup/popup.ts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const POPUP = join(HERE, 'popup.png');

const CONFIG = {
  bg: '#fdf9f3',
  // Left-hand headline, one array entry per rendered line.
  headline: ['Send any page', 'to your Readest', 'library.'],
  // Popup success status (keep in sync with src/popup/popup.ts).
  status: { text: 'Saved to your library.', color: '#78db88' },
  // popup.png is a 700x508 capture; these source coords place the status line
  // and define the dark strip that is blanked, then re-lettered as an overlay.
  popupSrc: { w: 700, h: 508, statusLeft: 33, statusTop: 420, statusFontPx: 27, coverTop: 400 },
  popupDisplayW: 560, // how wide the popup renders inside the 1280x800 canvas
};

const SIZES = [
  { w: 1280, h: 800 },
  { w: 640, h: 400 },
];

function magick(args) {
  execFileSync('magick', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function ensureMagick() {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('ImageMagick `magick` not found on PATH. Install it: brew install imagemagick');
    process.exit(1);
  }
}

function buildHtml(blankedPopupPath) {
  const s = CONFIG.popupDisplayW / CONFIG.popupSrc.w;
  const left = Math.round(CONFIG.popupSrc.statusLeft * s);
  const top = Math.round(CONFIG.popupSrc.statusTop * s);
  const font = (CONFIG.popupSrc.statusFontPx * s).toFixed(1);
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 1280px; height: 800px; }
    .canvas {
      position: relative; width: 1280px; height: 800px; overflow: hidden;
      background:
        radial-gradient(135% 120% at -5% -12%, rgba(249,190,116,0.55) 0%, rgba(249,190,116,0) 42%),
        radial-gradient(130% 120% at 106% 112%, rgba(244,188,198,0.62) 0%, rgba(244,188,198,0) 46%),
        ${CONFIG.bg};
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;
    }
    .headline {
      position: absolute; left: 90px; top: 50%; transform: translateY(-50%); width: 560px;
      color: #1c1c1e; font-weight: 800; font-size: 74px; line-height: 1.07; letter-spacing: -2px;
    }
    .popup-wrap { position: absolute; right: 40px; top: 50%; transform: translateY(-50%); width: ${CONFIG.popupDisplayW}px; }
    .pointer {
      position: absolute; top: -13px; right: 104px; width: 0; height: 0;
      border-left: 15px solid transparent; border-right: 15px solid transparent; border-bottom: 14px solid #1a1a1c;
    }
    .popup-frame { position: relative; }
    .popup {
      display: block; width: ${CONFIG.popupDisplayW}px; border-radius: 14px;
      box-shadow: 0 34px 64px -16px rgba(60,42,18,0.40), 0 14px 26px -10px rgba(60,42,18,0.26);
    }
    .status { position: absolute; left: ${left}px; top: ${top}px; line-height: 1; font-weight: 400;
      color: ${CONFIG.status.color}; font-size: ${font}px; }
  </style></head><body>
    <div class="canvas">
      <div class="headline">${CONFIG.headline.join('<br />')}</div>
      <div class="popup-wrap">
        <div class="pointer"></div>
        <div class="popup-frame">
          <img class="popup" src="file://${blankedPopupPath}" />
          <div class="status">${CONFIG.status.text}</div>
        </div>
      </div>
    </div>
  </body></html>`;
}

async function main() {
  ensureMagick();
  if (!existsSync(POPUP)) {
    console.error(`missing popup asset: ${POPUP}`);
    process.exit(1);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 1. Blank the popup's status strip so the configured status can be overlaid.
  const blanked = join(OUT, '_popup-blanked.png');
  const { w, h, coverTop } = CONFIG.popupSrc;
  magick([POPUP, '-fill', '#1a1a1a', '-draw', `rectangle 0,${coverTop} ${w},${h}`, blanked]);

  // 2. Render the composite at 2x for crisp downscaling.
  const htmlPath = join(OUT, '_composite.html');
  writeFileSync(htmlPath, buildHtml(blanked));
  const raw = join(OUT, '_render@2x.png');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await page.goto('file://' + htmlPath);
  await page.waitForTimeout(300);
  await page.screenshot({ path: raw });
  await browser.close();

  // 3. Downscale + flatten to each Web Store size (24-bit, no alpha).
  for (const { w: ow, h: oh } of SIZES) {
    const out = join(OUT, `send-to-readest-${ow}x${oh}.png`);
    magick([raw, '-resize', `${ow}x${oh}`, '-background', CONFIG.bg, '-flatten',
      '-alpha', 'remove', '-alpha', 'off', '-strip', out]);
    console.log(`wrote ${out}`);
  }

  for (const f of [blanked, htmlPath, raw]) rmSync(f, { force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
