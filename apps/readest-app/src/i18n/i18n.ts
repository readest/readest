import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpApi from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import { options } from '../../i18next-scanner.config';

i18n
  .use(HttpApi)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ['en', ...options.lngs],
    fallbackLng: {
      'zh-TW': ['zh-CN', 'en'],
      'de-CH': ['fr', 'it', 'en'],
      zh: ['zh-CN', 'zh-TW', 'en'],
      es: ['pt', 'it', 'fr', 'en'],
      pt: ['es', 'it', 'fr', 'en'],
      fr: ['es', 'it', 'pt', 'en'],
      it: ['es', 'fr', 'pt', 'en'],
    },
    ns: options.ns,
    defaultNS: options.defaultNs,
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    detection: {
      order: ['querystring', 'localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    keySeparator: false,
    nsSeparator: false,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

i18n.on('languageChanged', (lng) => {
  console.log('Language changed to', lng);
});

export default i18n;
