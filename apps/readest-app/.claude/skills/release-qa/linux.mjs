// node linux.mjs <cmd> ... — drive the Linux CEF app over CDP with Playwright.
//   shot NAME            screenshot (CSS scale) -> $QA_DIR/shots/NAME.png
//   eval '<async body>'  evaluate in the page, print JSON
//   run FILE [args...]   import FILE and call its default export({ page, pages, browser, args })
// Env: QA_APP (an apps/readest-app dir with playwright installed), QA_DIR, CDP_PORT (default 9231),
// PAGE_MATCH (URL substring; "lib" = the library window, "reader" = a reader window).
import { createRequire } from 'node:module';
import path from 'node:path';
const app = process.env.QA_APP;
if (!app) { console.error('set QA_APP'); process.exit(1); }
const { chromium } = createRequire(path.join(app, 'package.json'))('playwright');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.CDP_PORT || '9231'}`);
const pages = browser.contexts().flatMap((c) => c.pages());
// An explicit PAGE_MATCH must match: falling back to another window would act on it.
const want = process.env.PAGE_MATCH;
const page = !want ? pages[0] : want === 'lib' ? pages.find((p) => !p.url().includes('/reader')) : pages.find((p) => p.url().includes(want));
if (!page) { console.error(`no page matches PAGE_MATCH=${want ?? ''}:`, pages.map((p) => p.url()).join(' | ')); process.exit(1); }
const [cmd, ...rest] = process.argv.slice(2);
let code = 0;
try {
  if (cmd === 'shot') {
    const out = path.join(process.env.QA_DIR || '.', 'shots', `${rest[0]}.png`);
    await page.screenshot({ path: out, scale: 'css' });
    console.log(out, '|', pages.map((p) => p.url()).join(' | '));
  } else if (cmd === 'eval') {
    console.log(JSON.stringify(await page.evaluate(`(async()=>{ ${rest[0]} })()`), null, 1));
  } else if (cmd === 'run') {
    const mod = await import(path.resolve(rest[0]));
    await mod.default({ page, pages, browser, args: rest.slice(1) });
  } else {
    console.error('usage: linux.mjs shot NAME | eval JS | run FILE [args]');
    code = 2;
  }
} catch (e) {
  console.error('ERR', e.message.split('\n').slice(0, 6).join('\n'));
  code = 1;
}
process.exit(code);
