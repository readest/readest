/**
 * The `scroll-gap` attribute (px) a fixed-layout renderer should use for the
 * current Webtoon Mode state. `0` = seamless webtoon strip; `4` = the default
 * inter-page gap. The renderer maps this to the `--scroll-page-gap` CSS var.
 */
export const getScrollGapAttr = (webtoonMode: boolean): string => (webtoonMode ? '0' : '4');
