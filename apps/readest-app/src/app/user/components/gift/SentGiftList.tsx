import { useEffect, useRef, useState } from 'react';
import type { IconType } from 'react-icons';
import { MdContentCopy, MdEdit, MdLink, MdOutlineEmail } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { getGiftRedeemLink } from '@/libs/payment/gift/client';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';
import type { GiftCardPatch, SentGiftCard } from '@/types/gift';
import GiftCard, { type GiftCardSide } from './GiftCard';
import { GiftFaceFields, type GiftFaceText } from './GiftComposer';

type UpdateGift = (id: string, patch: GiftCardPatch) => Promise<void>;

const ActionButton: React.FC<{ icon: IconType; label: string; onClick: () => void }> = ({
  icon: Icon,
  label,
  onClick,
}) => (
  <button type='button' onClick={onClick} className='btn btn-ghost btn-sm gap-1.5 font-normal'>
    <Icon aria-hidden='true' className='h-4 w-4' />
    {label}
  </button>
);

const EmailEditor: React.FC<{ onSave: (email: string) => Promise<void>; onCancel: () => void }> = ({
  onSave,
  onCancel,
}) => {
  const _ = useTranslation();
  const [email, setEmail] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const trimmed = email.trim();

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  };

  // The email is set once, so saving asks before anything is written.
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) setConfirming(true);
      }}
      className='eink-bordered border-base-200 bg-base-100 flex flex-col gap-3 rounded-lg border p-3'
    >
      {confirming ? (
        <p className='break-words'>
          {_("Add {{email}} as the recipient? It can't be changed later.", { email: trimmed })}
        </p>
      ) : (
        <>
          <input
            type='email'
            required
            aria-label={_('Recipient email')}
            placeholder={_('Recipient email')}
            value={email}
            autoComplete='off'
            autoCapitalize='off'
            spellCheck={false}
            onChange={(event) => setEmail(event.target.value)}
            className='input input-sm eink-bordered w-full'
          />
          <p className='text-base-content/70 text-xs leading-relaxed'>
            {_(
              "The email can't be changed later. If they sign in with Apple's Hide My Email, use the code instead.",
            )}
          </p>
        </>
      )}
      <div className='flex justify-end gap-2'>
        <button type='button' onClick={onCancel} className='btn btn-ghost btn-sm'>
          {_('Cancel')}
        </button>
        {/* Back to the address, kept, to correct it (after a failed save too). */}
        {confirming && (
          <button
            type='button'
            disabled={saving}
            onClick={() => setConfirming(false)}
            className='btn btn-ghost btn-sm'
          >
            {_('Back')}
          </button>
        )}
        {confirming ? (
          <button
            type='button'
            disabled={saving}
            aria-busy={saving}
            onClick={confirm}
            className='btn btn-contrast btn-sm'
          >
            {saving && <span className='loading loading-spinner loading-xs' />}
            {_('Confirm')}
          </button>
        ) : (
          <button type='submit' disabled={!trimmed} className='btn btn-contrast btn-sm'>
            {_('Save')}
          </button>
        )}
      </div>
    </form>
  );
};

const SentGiftItem: React.FC<{ card: SentGiftCard; write: boolean; onUpdate: UpdateGift }> = ({
  card,
  write,
  onUpdate,
}) => {
  const _ = useTranslation();
  const [editing, setEditing] = useState<'email' | 'message' | null>(null);
  const [face, setFace] = useState<GiftFaceText>(card);
  const [saving, setSaving] = useState(false);
  const [side, setSide] = useState<GiftCardSide>('front');
  const item = useRef<HTMLLIElement>(null);
  // Each opened editor is a session; a save closes only the one it began in,
  // not an editor opened while it was on its way.
  const session = useRef(0);
  const openEditor = (kind: 'email' | 'message' | null) => {
    session.current++;
    setEditing(kind);
  };

  // Just paid for: open it on the bookplate, ready to write.
  useEffect(() => {
    if (!write) return;
    setFace(card);
    openEditor('message');
    setSide('back');
    item.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    // Only when it becomes the card to write, not on every reload of it.
  }, [write]);
  const open = card.status === 'unredeemed' || card.status === 'waiting';
  const code = open ? card.code : null;

  const status = {
    unredeemed: _('Not redeemed yet'),
    waiting: _('Waiting for {{email}} to sign up', { email: card.recipientEmail ?? '' }),
    redeemed: _('Redeemed on {{date}}', {
      date: card.redeemedAt ? new Date(card.redeemedAt).toLocaleDateString(getLocale()) : '',
    }),
    refunded: _('Refunded'),
  }[card.status];

  const copy = async (text: string) => {
    if (await writeTextToClipboard(text)) {
      eventDispatcher.dispatch('toast', { type: 'info', message: _('Copied') });
    }
  };

  // The section toasts a failure and rethrows it, so the editor stays open.
  const save = async (patch: GiftCardPatch) => {
    const mine = session.current;
    try {
      await onUpdate(card.id, patch);
      if (mine === session.current) setEditing(null);
    } catch {
      // Already shown to the buyer; keep what they typed.
    }
  };

  const saveFace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    await save({
      recipientName: face.recipientName.trim(),
      senderName: face.senderName.trim(),
      message: face.message.trim(),
    });
    setSaving(false);
  };

  return (
    <li ref={item} className='flex scroll-mt-16 flex-col gap-3'>
      {/* The card face follows the message while it's edited. */}
      <GiftCard
        face={editing === 'message' ? { ...card, ...face } : card}
        year={new Date(card.purchasedAt).getFullYear()}
        side={side}
        onSideChange={setSide}
      />
      <div className='flex flex-col gap-2 px-1'>
        <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
          <span className='min-w-0 break-words font-medium'>
            {/* Bought in a store's sandbox: shown, never claimed. */}
            {card.test && card.status === 'unredeemed' ? _("Test card, can't be redeemed") : status}
          </span>
          {code && (
            <code dir='ltr' className='select-all font-mono text-[0.9em] tracking-wider'>
              {code}
            </code>
          )}
        </div>

        {open && !editing && (
          <div className='-ms-3 flex flex-wrap'>
            {code && (
              <ActionButton
                icon={MdContentCopy}
                label={_('Copy code')}
                onClick={() => copy(code)}
              />
            )}
            {code && (
              <ActionButton
                icon={MdLink}
                label={_('Copy link')}
                onClick={() => copy(getGiftRedeemLink(code))}
              />
            )}
            {card.status === 'unredeemed' && !card.test && (
              <ActionButton
                icon={MdOutlineEmail}
                label={_('Add recipient email')}
                onClick={() => openEditor('email')}
              />
            )}
            <ActionButton
              icon={MdEdit}
              label={_('Edit message')}
              onClick={() => {
                setFace(card);
                openEditor('message');
                setSide('back');
              }}
            />
          </div>
        )}

        {editing === 'email' && (
          <EmailEditor
            onSave={(email) => save({ recipientEmail: email })}
            onCancel={() => openEditor(null)}
          />
        )}

        {editing === 'message' && (
          <form onSubmit={saveFace} className='flex flex-col gap-3'>
            <GiftFaceFields value={face} onChange={setFace} />
            <div className='flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => openEditor(null)}
                className='btn btn-ghost btn-sm'
              >
                {_('Cancel')}
              </button>
              <button
                type='submit'
                disabled={saving}
                aria-busy={saving}
                className='btn btn-contrast btn-sm'
              >
                {saving && <span className='loading loading-spinner loading-xs' />}
                {_('Save')}
              </button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
};

interface SentGiftListProps {
  cards: SentGiftCard[];
  /** The card just bought, opened for writing. */
  writeId?: string | null;
  onUpdate: UpdateGift;
}

const SentGiftList: React.FC<SentGiftListProps> = ({ cards, writeId, onUpdate }) => (
  <ul className='grid gap-8 sm:grid-cols-2'>
    {cards.map((card) => (
      <SentGiftItem key={card.id} card={card} write={card.id === writeId} onUpdate={onUpdate} />
    ))}
  </ul>
);

export default SentGiftList;
