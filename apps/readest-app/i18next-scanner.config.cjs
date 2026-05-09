const lngs = require('./i18n-langs.json');

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
  input: ['src/**/*.{js,jsx,ts,tsx}', '!src/**/*.test.{js,jsx,ts,tsx}'],
  output: '.',
  options,
};
