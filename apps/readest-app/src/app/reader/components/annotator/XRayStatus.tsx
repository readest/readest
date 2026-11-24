import React, { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { XRayMentions } from '@/services/xray/mentions';
import {
  getBookMentions,
  isXRayAvailable,
  openMention,
  openQuote,
  stopXRayUpdate,
  updateXRay,
  useXRayStore,
} from '@/services/xray/xrayService';
import type { XRayQuote } from '@/services/xray/types';
import { useBookXRay } from '../../hooks/useBookXRay';

const MENTIONS = 5;

const Quotes: React.FC<{ quotes: { text: string; open: () => void }[] }> = ({ quotes }) => {
  const _ = useTranslation();
  return (
    <ul className='mt-1 space-y-1'>
      {quotes.map(({ text, open }, index) => (
        <li key={index}>
          <button
            type='button'
            title={_('Jump to quote')}
            onClick={open}
            className='not-eink:opacity-75 not-eink:hover:bg-base-300/60 min-h-8 w-full rounded-md px-1.5 py-1 text-start text-sm italic'
          >
            “{text}”
          </button>
        </li>
      ))}
    </ul>
  );
};

export const XRayQuotes: React.FC<{ bookKey: string; quotes: readonly XRayQuote[] }> = ({
  bookKey,
  quotes,
}) => (
  <Quotes quotes={quotes.map(({ text, cfi }) => ({ text, open: () => openQuote(bookKey, cfi) }))} />
);

/** Where the book has mentioned `names`: the first time and the latest ones. */
export const XRayMentionList: React.FC<{ bookKey: string; names: readonly string[] }> = ({
  bookKey,
  names,
}) => {
  const _ = useTranslation();
  const [mentions, setMentions] = useState<XRayMentions>();
  const key = names.join('\0');
  useEffect(() => {
    let stale = false;
    void getBookMentions(bookKey, key.split('\0'), MENTIONS).then((found) => {
      if (!stale) setMentions(found);
    });
    return () => {
      stale = true;
    };
  }, [bookKey, key]);
  if (!mentions?.count) return null;
  return (
    <div className='w-full text-start'>
      <p className='not-eink:opacity-60 text-xs'>
        {_('Mentions')} · {mentions.count}
      </p>
      <Quotes
        quotes={mentions.mentions.map((mention) => ({
          text: mention.text,
          open: () => void openMention(bookKey, mention),
        }))}
      />
    </div>
  );
};

/** Reads the book into its X-Ray, stops that, and says how the last one ended. */
export const XRayUpdateButton: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const update = useXRayStore((s) => s.updates[bookKey.split('-')[0]!]);
  return (
    <div className='flex flex-col items-center gap-2'>
      <button
        type='button'
        className='btn btn-sm btn-contrast'
        onClick={() => (update?.running ? stopXRayUpdate(bookKey) : void updateXRay(bookKey))}
      >
        {update?.running && <span className='loading loading-spinner loading-xs eink:hidden' />}
        {update?.running ? _('Stop') : _('Update X-Ray')}
      </button>
      {update?.error && (
        <p role='alert' className='text-error text-sm'>
          {_(update.error)}
        </p>
      )}
    </div>
  );
};

/** In place of an X-Ray entry, and of an empty X-Ray tab: what the book says, and the update. */
const XRayStatus: React.FC<{ bookKey: string; word?: string }> = ({ bookKey, word }) => {
  const _ = useTranslation();
  const xray = useBookXRay(bookKey);
  if (xray === undefined) return null;
  return (
    <div className='flex min-h-full flex-col items-center justify-center gap-4 px-4 py-3 text-center'>
      {word && <XRayMentionList bookKey={bookKey} names={[word]} />}
      <p className='not-eink:opacity-70 text-sm'>
        {!isXRayAvailable()
          ? _('Add an OpenAI-compatible translator in Custom Translators to use it.')
          : xray
            ? _('No X-Ray match found up to your current location.')
            : _('X-Ray uses only what you have read.')}
      </p>
      {isXRayAvailable() && <XRayUpdateButton bookKey={bookKey} />}
    </div>
  );
};

export default XRayStatus;
