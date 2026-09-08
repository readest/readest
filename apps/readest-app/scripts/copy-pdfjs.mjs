import fs from 'node:fs';
import path from 'node:path';

const targetDir = path.resolve('public/vendor/pdfjs');
fs.mkdirSync(targetDir, { recursive: true });

const candidates = [
  '../../packages/foliate-js/node_modules/pdfjs-dist',
  'node_modules/pdfjs-dist',
  '../../node_modules/pdfjs-dist',
];

const pdfjsDir = candidates.find(c => fs.existsSync(path.resolve(c)));

if (!pdfjsDir) {
  console.error('❌ ERROR: Could not find pdfjs-dist in node_modules!');
  process.exit(1);
}

const resolvedPdfjs = path.resolve(pdfjsDir);
console.log(`✅ Found pdfjs-dist at: ${resolvedPdfjs}`);

// Copy JS files
const legacyBuild = path.join(resolvedPdfjs, 'legacy/build');
for (const file of ['pdf.worker.min.mjs', 'pdf.min.mjs', 'pdf.d.mts']) {
  const src = path.join(legacyBuild, file);
  const dest = path.join(targetDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file} -> ${dest}`);
  } else {
    console.error(`❌ Missing expected file: ${src}`);
    process.exit(1);
  }
}

// Copy WASM
const wasmDir = path.join(resolvedPdfjs, 'wasm');
if (fs.existsSync(wasmDir)) {
  for (const file of fs.readdirSync(wasmDir)) {
    fs.copyFileSync(path.join(wasmDir, file), path.join(targetDir, file));
  }
}

// Copy cmaps & standard_fonts
for (const dir of ['cmaps', 'standard_fonts']) {
  const srcDir = path.join(resolvedPdfjs, dir);
  const destDir = path.join(targetDir, dir);
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, destDir, { recursive: true });
  }
}
