import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(duration);

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

// Clock-style playback time for the TTS scrubber: m:ss below one hour,
// h:mm:ss above. Pass forceHours so both labels of a row share the format
// chosen by the total's magnitude and the row never re-layouts when the
// elapsed side crosses an hour.
export const formatPlaybackTime = (seconds: number, forceHours = false): string => {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0 || forceHours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};
