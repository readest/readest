import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function findPdfJsDir() {
  const searchPaths = [
    path.resolve(process.cwd(), '../../packages/foliate-js'),
    process.cwd(),
    path.resolve(process.cwd(), '../..'),
  ];
  try {
    const pkgPath = require.resolve('pdfjs-dist/package.json', { paths: searchPaths });
    return path.dirname(pkgPath);
  } catch (err) {
    let curr = process.cwd();
    while (curr && curr !== path.dirname(curr)) {
      const candidates = [
        path.join(curr, 'node_modules/pdfjs-dist'),
        path.join(curr, 'packages/foliate-js/node_modules/pdfjs-dist'),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(path.join(cand, 'package.json'))) {
          return cand;
        }
      }
      curr = path.dirname(curr);
    }
  }
  throw new Error('Could not resolve pdfjs-dist package directory');
}

const pdfjsDir = findPdfJsDir();
console.log('[copy-pdfjs-vendor] Found pdfjs-dist at:', pdfjsDir);

const destDir = path.resolve(process.cwd(), 'public/vendor/pdfjs');
fs.mkdirSync(destDir, { recursive: true });

const buildDirCandidates = [
  path.join(pdfjsDir, 'legacy/build'),
  path.join(pdfjsDir, 'build'),
];
const buildDir = buildDirCandidates.find((d) => fs.existsSync(d));

if (!buildDir) {
  throw new Error(`[copy-pdfjs-vendor] Could not find build directory in ${pdfjsDir}`);
}

const jsFilesToCopy = ['pdf.worker.min.mjs', 'pdf.min.mjs', 'pdf.d.mts'];
for (const file of jsFilesToCopy) {
  const src = path.join(buildDir, file);
  const dest = path.join(destDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[copy-pdfjs-vendor] Copied ${file} -> ${dest}`);
  } else {
    throw new Error(`[copy-pdfjs-vendor] Required PDF.js file missing: ${src}`);
  }
}

const wasmDir = path.join(pdfjsDir, 'wasm');
if (fs.existsSync(wasmDir)) {
  for (const f of fs.readdirSync(wasmDir)) {
    fs.copyFileSync(path.join(wasmDir, f), path.join(destDir, f));
  }
  console.log('[copy-pdfjs-vendor] Copied WASM assets');
}

for (const sub of ['cmaps', 'standard_fonts']) {
  const srcSub = path.join(pdfjsDir, sub);
  const destSub = path.join(destDir, sub);
  if (fs.existsSync(srcSub)) {
    fs.cpSync(srcSub, destSub, { recursive: true });
    console.log(`[copy-pdfjs-vendor] Copied ${sub}`);
  }
}

console.log('[copy-pdfjs-vendor] PDF.js vendor assets successfully copied to', destDir);