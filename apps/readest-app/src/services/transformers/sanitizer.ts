import DOMPurify from 'dompurify';
import type { Transformer } from './types';

export const sanitizerTransformer: Transformer = {
  name: 'sanitizer',

  transform: async (ctx) => {
    const allowScript = ctx.viewSettings.allowScript;
    if (allowScript) return ctx.content;

    let result = ctx.content;

    let sanitized = DOMPurify.sanitize(result, {
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: ['script'],
      ALLOWED_URI_REGEXP:
        /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      ADD_TAGS: ['link', 'meta'],
      ADD_ATTR: (attributeName: string) => {
        return (
          ['xmlns'].includes(attributeName) ||
          attributeName.startsWith('xml:') ||
          attributeName.startsWith('xmlns:') ||
          attributeName.startsWith('epub:')
        );
      },
    });

    sanitized = '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>' + sanitized;

    // console.log(`Sanitizer diff:\n${diff(result, sanitized)}`);

    return sanitized;
  },
};
