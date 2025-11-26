export const localizeNumber = (num: number, language: string, isIndex = false): string => {
  const lang = language.toLowerCase();
  const isChinese = lang.startsWith('zh');
  if (!isChinese) {
    return num.toString();
  }

  const isTraditional = lang.includes('tw') || lang.includes('hk');

  const baseDigits = isTraditional ? '零壹貳叁肆伍陸柒捌玖' : '零一二三四五六七八九';
  const zeroChar = isIndex ? '〇' : '零';
  const digits = baseDigits.replace('零', zeroChar);
  const units = isTraditional
    ? ['', '拾', '佰', '仟', '萬', '億']
    : ['', '十', '百', '千', '万', '亿'];

  const str = String(num);
  const len = str.length;
  let result = '';
  for (let i = 0; i < len; i++) {
    const n = Number(str[i]);
    const pos = len - i - 1;
    if (n !== 0) {
      result += digits[n]! + units[pos % 4]!;
    } else if (!result.endsWith(zeroChar) && i < len - 1) {
      result += zeroChar;
    }
    if (pos === 4) result += units[4];
    if (pos === 8) result += units[5];
  }
  result = result
    .replace(new RegExp(`${zeroChar}+$`), '')
    .replace(`${zeroChar}萬`, '萬')
    .replace(`${zeroChar}万`, '万')
    .replace(new RegExp(`${zeroChar}+`, 'g'), zeroChar);

  if (!isIndex) {
    if (isTraditional) {
      result = result
        .replace(/^貳$/, '兩')
        .replace(/(^|[^壹貳叁肆伍陸柒捌玖])貳([^佰仟萬億壹貳叁肆伍陸柒捌玖]|$)/g, '$1兩$2');
    } else {
      result = result
        .replace(/^二$/, '两')
        .replace(/(^|[^一二三四五六七八九])二([^百千万亿一二三四五六七八九]|$)/g, '$1两$2');
    }
  }

  return result;
};
