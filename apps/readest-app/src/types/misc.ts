export type Insets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type LocaleWithTextInfo = Intl.Locale & {
  getTextInfo?: () => { direction: string };
  textInfo?: { direction: string };
};
