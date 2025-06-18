import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

import 'dayjs/locale/en';
import 'dayjs/locale/zh';
import 'dayjs/locale/de';
import 'dayjs/locale/ja';
import 'dayjs/locale/ko';
import 'dayjs/locale/ru';
import 'dayjs/locale/fr';
import 'dayjs/locale/el';
import 'dayjs/locale/es';
import 'dayjs/locale/it';
import 'dayjs/locale/pt';
import 'dayjs/locale/pt-br';
import 'dayjs/locale/ar';
import 'dayjs/locale/id';
import 'dayjs/locale/hi';
import 'dayjs/locale/th';
import 'dayjs/locale/tr';
import 'dayjs/locale/vi';
import 'dayjs/locale/uk';
import 'dayjs/locale/pl';
import 'dayjs/locale/fi';
import 'dayjs/locale/nl';
import 'dayjs/locale/ro';
import 'dayjs/locale/zh-tw';
import 'dayjs/locale/zh-cn';

export const initDayjs = (locale: string) => {
  dayjs.locale(locale);
  dayjs.extend(relativeTime);
};
