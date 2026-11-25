// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sanitizeGiftDraft, sanitizeGiftPatch } from '@/libs/payment/gift/validate';

const base = {
  tier: 'pro',
  recipientName: ' Sam ',
  senderName: 'Alex',
  message: 'Hi',
  recipientEmail: ' Sam@Example.com ',
};

describe('sanitizeGiftDraft', () => {
  it('trims and lowercases', () => {
    expect(sanitizeGiftDraft(base)).toEqual({
      tier: 'pro',
      recipientName: 'Sam',
      senderName: 'Alex',
      message: 'Hi',
      recipientEmail: 'sam@example.com',
    });
  });

  it('maps an empty email to null', () => {
    expect(sanitizeGiftDraft({ ...base, recipientEmail: '' })?.recipientEmail).toBeNull();
  });

  it('rejects invalid input', () => {
    expect(sanitizeGiftDraft({ ...base, tier: 'purchase' })).toBeNull();
    expect(sanitizeGiftDraft({ ...base, message: 'x'.repeat(301) })).toBeNull();
    expect(sanitizeGiftDraft({ ...base, recipientName: 'x'.repeat(61) })).toBeNull();
    expect(sanitizeGiftDraft({ ...base, recipientEmail: 'not-an-email' })).toBeNull();
    expect(sanitizeGiftDraft(null)).toBeNull();
  });
});

describe('sanitizeGiftPatch', () => {
  it('keeps known keys and drops unknown ones', () => {
    expect(sanitizeGiftPatch({ message: 'x' })).toEqual({ message: 'x' });
    expect(sanitizeGiftPatch({ message: 'x', tier: 'pro', evil: 1 })).toEqual({ message: 'x' });
  });

  it('rejects invalid values', () => {
    expect(sanitizeGiftPatch({ message: 'x'.repeat(301) })).toBeNull();
    expect(sanitizeGiftPatch('nope')).toBeNull();
  });
});
