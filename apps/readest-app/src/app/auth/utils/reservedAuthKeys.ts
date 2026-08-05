import { stubTranslation as _ } from '@/utils/misc';

// Translation keys carried over from the Supabase Auth UI verify_otp view.
// Not rendered by the first-party auth panel; declared so the i18n scanner
// keeps their existing translations across all locales.
export const RESERVED_AUTH_KEYS = [
  _('Phone number'),
  _('Your phone number'),
  _('Token'),
  _('Your OTP token'),
  _('Verify token'),
];
