export const sanitizeString = (str?: string) => {
  if (!str) return str;
  return str.replace(/\u0000/g, '');
};
