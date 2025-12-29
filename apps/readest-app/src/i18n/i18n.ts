import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { options } from '../../i18next-scanner.config';

const isBrowser = typeof window !== 'undefined';

const initI18n = async () => {
  if (isBrowser) {
    const HttpApi = (await import('i18next-http-backend')).default;
    i18n.use(HttpApi);
  }

  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      supportedLngs: ['en', ...options.lngs],
      fallbackLng: {
        'zh-HK': ['zh-TW', 'en'],
        kk: ['ru', 'en'],
        ky: ['ru', 'en'],
        tk: ['ru', 'en'],
        uz: ['ru', 'en'],
        ug: ['ru', 'en'],
        tt: ['ru', 'en'],
        default: ['en'],
      },
      ns: options.ns,
      defaultNS: options.defaultNs,
      ...(isBrowser && {
        backend: {
          loadPath: '/locales/{{lng}}/{{ns}}.json',
        },
      }),
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
};

initI18n();

export default i18n;
