const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 16;

export const generateGiftCode = (): string => {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 32 divides 256, so masking to 5 bits is unbiased.
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
};

export const normalizeGiftCode = (input: string): string =>
  input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

export const formatGiftCode = (code: string): string => code.replace(/(.{4})(?=.)/g, '$1-');
