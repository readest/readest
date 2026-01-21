export type Insets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export interface LocaleWithTextInfo extends Intl.Locale {
  getTextInfo?: () => { direction: string };
  textInfo?: { direction: string };
}
