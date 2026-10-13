export const CUSTOM_TRANSLATOR_PREFIX = 'custom:';

export const isCustomTranslatorName = (name: string | undefined): boolean =>
  !!name?.startsWith(CUSTOM_TRANSLATOR_PREFIX);
