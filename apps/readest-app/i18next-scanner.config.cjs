const fs = require('fs');
const lngs = require('./i18n-langs.json');

// Resolve globs ourselves and drop directory matches. The scanner pipes the
// input through vinyl-fs without `nodir: true`, so directories whose names
// look like source files (e.g. Next.js route folders like `runtime-config.js/`
// or screenshot folders like `*.test.tsx/`) blow up with EISDIR.
const resolveInput = (patterns) => {
  const positives = patterns.filter((p) => !p.startsWith('!'));
  const excludes = patterns
    .filter((p) => p.startsWith('!'))
    .map((p) => p.slice(1));
  const matched = new Set();
  for (const pattern of positives) {
    for (const entry of fs.globSync(pattern, { exclude: excludes })) {
      try {
        if (fs.statSync(entry).isFile()) matched.add(entry);
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return [...matched];
};

const options = {
  debug: false,
  sort: false,
  func: {
    list: ['_'],
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
  lngs,
  ns: ['translation'],
  defaultNs: 'translation',
  defaultValue: '__STRING_NOT_TRANSLATED__',
  resource: {
    loadPath: './public/locales/{{lng}}/{{ns}}.json',
    savePath: './public/locales/{{lng}}/{{ns}}.json',
    jsonIndent: 2,
    lineEnding: '\n',
  },
  keySeparator: false,
  nsSeparator: false,
  interpolation: {
    prefix: '{{',
    suffix: '}}',
  },
  metadata: {},
  allowDynamicKeys: true,
  removeUnusedKeys: true,
};

module.exports = {
  input: resolveInput(['src/**/*.{js,jsx,ts,tsx}', '!src/**/*.test.{js,jsx,ts,tsx}']),
  output: '.',
  options,
};
