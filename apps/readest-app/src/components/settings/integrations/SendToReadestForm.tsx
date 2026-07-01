import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdContentCopy, MdRefresh, MdCheck, MdClose, MdAdd } from 'react-icons/md';
import { RiSendPlaneLine } from 'react-icons/ri';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/context/AuthContext';
import { fetchWithAuth } from '@/utils/fetch';
import { getAPIBaseUrl } from '@/services/environment';
import { isInboxDrainEnabled, setInboxDrainEnabled } from '@/services/send/devicePrefs';
import { getAccessToken, getUserProfilePlan, isEmailInPlan } from '@/utils/access';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import type { UserPlan } from '@/types/quota';
import type { DBSendAllowedSender, DBSendInboxItem } from '@/types/sendRecords';
import SubPageHeader from '../SubPageHeader';
import { BoxedList, SectionTitle, SettingLabel, SettingsSwitchRow } from '../primitives';

interface SendToReadestFormProps {
  onBack: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pull the editable slug out of a `{slug}-{token}@domain` address. */
function slugOf(address: string): string {
  const local = address.split('@')[0] ?? '';
  const dash = local.lastIndexOf('-');
  return dash > 0 ? local.slice(0, dash) : local;
}

/** The fixed `-{token}@domain` part shown after the editable slug. */
function suffixOf(address: string): string {
  return address.slice(slugOf(address).length);
}

const SendToReadestForm: React.FC<SendToReadestFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const apiBase = getAPIBaseUrl();

  const [address, setAddress] = useState<string>('');
  const [senders, setSenders] = useState<DBSendAllowedSender[]>([]);
  const [activity, setActivity] = useState<DBSendInboxItem[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [slugInput, setSlugInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drainEnabled, setDrainEnabled] = useState(() => isInboxDrainEnabled());
  // `null` while we're still reading the JWT; lets the loading skeleton
  // stay up rather than briefly flashing the upgrade card for a paid user
  // on a slow client.
  const [userPlan, setUserPlan] = useState<UserPlan | null>(null);
  const canUseEmailIn = userPlan !== null && isEmailInPlan(userPlan);
  // Editing affordances stay collapsed once configured, keeping the panel
  // minimal; the refresh / plus icons reveal the input rows.
  const [editingAddress, setEditingAddress] = useState(false);
  const [addingSender, setAddingSender] = useState(false);

  const toast = (message: string, type: 'info' | 'error' | 'success' = 'info') =>
    eventDispatcher.dispatch('toast', { message, type, timeout: 2500 });

  const toggleDrain = () => {
    const next = !drainEnabled;
    setDrainEnabled(next);
    setInboxDrainEnabled(next);
  };

  const load = useCallback(async () => {
    try {
      // Resolve the user's plan first — free users get the upgrade card and
      // we skip the address / senders calls entirely (they'd 403 anyway).
      const token = await getAccessToken();
      const plan: UserPlan = token ? getUserProfilePlan(token) : 'free';
      setUserPlan(plan);
      if (!isEmailInPlan(plan)) {
        setLoading(false);
        return;
      }
      const [addrRes, sendersRes, inboxRes] = await Promise.all([
        fetchWithAuth(`${apiBase}/send/address`, { method: 'GET' }),
        fetchWithAuth(`${apiBase}/send/senders`, { method: 'GET' }),
        fetchWithAuth(`${apiBase}/send/inbox`, { method: 'GET' }),
      ]);
      const addrData = (await addrRes.json()) as { address: string };
      const sendersData = (await sendersRes.json()) as { senders: DBSendAllowedSender[] };
      const inboxData = (await inboxRes.json()) as { items: DBSendInboxItem[] };
      setAddress(addrData.address);
      setSlugInput(slugOf(addrData.address));
      setSenders(sendersData.senders);
      setActivity(inboxData.items);
    } catch {
      toast(_('Could not load Send to Readest settings'), 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast(_('Address copied'), 'success');
    } catch {
      toast(_('Could not copy address'), 'error');
    }
  };

  // Saving issues a fresh address: the chosen slug + a new token suffix.
  // (Leaving the slug unchanged and saving is also how you rotate a leaked
  // address — the token is always regenerated.)
  const saveAddress = async () => {
    const slug = slugInput.trim();
    if (!slug) {
      toast(_('Enter a name for your address'), 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${apiBase}/send/address`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const data = (await res.json()) as { address: string };
      setAddress(data.address);
      setSlugInput(slugOf(data.address));
      setEditingAddress(false);
      toast(_('Address updated'), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : _('Could not update address'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const addSender = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      toast(_('Enter a valid email address'), 'error');
      return;
    }
    try {
      const res = await fetchWithAuth(`${apiBase}/send/senders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { sender: DBSendAllowedSender };
      setSenders((prev) => [...prev.filter((s) => s.id !== data.sender.id), data.sender]);
      setNewEmail('');
      setAddingSender(false);
    } catch {
      toast(_('Could not add sender'), 'error');
    }
  };

  const approveSender = async (id: string) => {
    try {
      await fetchWithAuth(`${apiBase}/send/senders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSenders((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'approved' } : s)));
    } catch {
      toast(_('Could not approve sender'), 'error');
    }
  };

  const removeSender = async (id: string) => {
    try {
      await fetchWithAuth(`${apiBase}/send/senders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSenders((prev) => prev.filter((s) => s.id !== id));
    } catch {
      toast(_('Could not remove sender'), 'error');
    }
  };

  return (
    <div className='my-4 w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Send to Readest')}
        description={_('Email books and articles straight into your library.')}
        onBack={onBack}
      />

      {!user ? (
        <div className='flex flex-col items-center gap-4 px-6 py-16 text-center'>
          <span className='bg-base-200 text-base-content/60 flex h-16 w-16 items-center justify-center rounded-full'>
            <RiSendPlaneLine className='h-7 w-7' />
          </span>
          <p className='text-base-content/70 max-w-xs text-sm leading-relaxed'>
            {_('Sign in to send books and articles to your library.')}
          </p>
          <button
            type='button'
            className='btn btn-contrast btn-sm'
            onClick={() => navigateToLogin(router)}
          >
            {_('Sign in')}
          </button>
        </div>
      ) : loading ? (
        <div className='space-y-6' aria-busy='true'>
          {[
            { key: 'address', card: 'h-28' },
            { key: 'senders', card: 'h-32' },
            { key: 'activity', card: 'h-24' },
          ].map((section) => (
            <div key={section.key} className='w-full'>
              <div className='skeleton mb-2 h-4 w-36' />
              <div className={`skeleton w-full rounded-xl ${section.card}`} />
            </div>
          ))}
        </div>
      ) : !canUseEmailIn ? (
        // Free-tier gate. One card, one CTA, plus a callout for the free
        // clip channels so the panel doesn't read as pure paywall.
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='flex flex-col items-center gap-3 px-6 py-8 text-center'>
            <span className='bg-base-200 text-base-content/70 flex h-14 w-14 items-center justify-center rounded-full'>
              <RiSendPlaneLine className='h-6 w-6' />
            </span>
            <h3 className='text-base font-semibold'>{_('Email books straight to your library')}</h3>
            <p className='text-base-content/70 max-w-sm text-sm leading-relaxed'>
              {_(
                'Forward attachments and articles to your private Readest address. Available on the Plus, Pro, and Lifetime plans.',
              )}
            </p>
            <button
              type='button'
              className='btn btn-contrast btn-sm mt-1'
              onClick={() => navigateToProfile(router)}
            >
              {_('View plans')}
            </button>
            <p className='text-base-content/55 mt-2 max-w-sm text-xs leading-relaxed'>
              {_(
                'You can still clip articles for free with the in-app Send button, the mobile Share menu, or the browser extension.',
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className='space-y-6'>
          <div className='w-full'>
            <SectionTitle className='mb-2'>{_('Your inbound address')}</SectionTitle>
            <div className='card eink-bordered border-base-200 bg-base-100 divide-base-200 overflow-hidden border'>
              <div className='flex items-center gap-2 px-4 py-3'>
                <code className='line-clamp-2 min-w-0 flex-1 break-all text-sm'>{address}</code>
                {address && (
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm eink-bordered'
                    onClick={() => setEditingAddress((v) => !v)}
                    aria-label={_('Change address name')}
                  >
                    <MdRefresh className='h-4 w-4' />
                  </button>
                )}
                <button
                  type='button'
                  className='btn btn-ghost btn-sm eink-bordered'
                  onClick={copyAddress}
                  aria-label={_('Copy address')}
                >
                  <MdContentCopy className='h-4 w-4' />
                </button>
              </div>
              {(editingAddress || !address) && (
                <div className='border-base-200 flex items-center gap-2 border-t px-4 py-3'>
                  <input
                    type='text'
                    className='input input-sm input-bordered eink-bordered min-w-0 flex-1'
                    value={slugInput}
                    onChange={(e) => setSlugInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveAddress();
                    }}
                    aria-label={_('Customize your address name')}
                    placeholder={_('your-name')}
                  />
                  <span className='text-base-content/55 shrink-0 text-xs'>{suffixOf(address)}</span>
                  <button
                    type='button'
                    className='btn btn-contrast btn-sm'
                    onClick={saveAddress}
                    disabled={saving || !slugInput.trim()}
                  >
                    <MdRefresh className='h-4 w-4' />
                    {_('Save')}
                  </button>
                </div>
              )}
            </div>
            <p className='text-base-content/65 mt-1 ps-4 text-[0.8em] leading-relaxed'>
              {_('Email a book or document to this address from an approved sender below.')}
            </p>
          </div>

          <div className='w-full'>
            <SectionTitle className='mb-2'>{_('Approved senders')}</SectionTitle>
            <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
              <div className='divide-base-200 divide-y'>
                {senders.length === 0 && (
                  <div className='text-base-content/60 px-4 py-3 text-sm'>
                    {_('No approved senders yet. Add an email to let it send to your library.')}
                  </div>
                )}
                {senders.map((sender) => (
                  <div key={sender.id} className='flex items-center gap-3 px-4 py-3'>
                    <div className='flex min-w-0 flex-1 flex-col'>
                      <code className='line-clamp-2 break-all text-sm'>{sender.email}</code>
                      {sender.status === 'pending' && (
                        <span className='text-warning text-[0.8em]'>{_('Pending approval')}</span>
                      )}
                    </div>
                    {sender.status === 'pending' && (
                      <button
                        type='button'
                        className='btn btn-ghost btn-sm eink-bordered'
                        onClick={() => approveSender(sender.id)}
                        aria-label={_('Approve')}
                      >
                        <MdCheck className='h-4 w-4' />
                      </button>
                    )}
                    <button
                      type='button'
                      className='btn btn-ghost btn-sm eink-bordered'
                      onClick={() => setAddingSender((v) => !v)}
                      aria-label={_('Add a sender')}
                    >
                      <MdAdd className='h-4 w-4' />
                    </button>
                    <button
                      type='button'
                      className='btn btn-ghost btn-sm eink-bordered'
                      onClick={() => removeSender(sender.id)}
                      aria-label={_('Remove')}
                    >
                      <MdClose className='h-4 w-4' />
                    </button>
                  </div>
                ))}
              </div>
              {(addingSender || senders.length === 0) && (
                <div className='border-base-200 flex items-center gap-2 border-t px-4 py-3'>
                  <input
                    type='email'
                    className='input input-sm input-bordered eink-bordered min-w-0 flex-1'
                    placeholder={_('name@example.com')}
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addSender();
                    }}
                  />
                  <button type='button' className='btn btn-contrast btn-sm' onClick={addSender}>
                    {_('Add')}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className='w-full'>
            <SectionTitle className='mb-2'>{_('Recent activity')}</SectionTitle>
            <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
              <div className='divide-base-200 divide-y'>
                {activity.length === 0 && (
                  <div className='text-base-content/60 px-4 py-3 text-sm'>
                    {_('Nothing sent yet. Email a book to your address above.')}
                  </div>
                )}
                {activity.map((item) => (
                  <div key={item.id} className='flex items-center gap-3 px-4 py-3'>
                    <div className='flex min-w-0 flex-1 flex-col'>
                      <SettingLabel className='!line-clamp-1'>
                        {item.filename || item.url || _('Untitled')}
                      </SettingLabel>
                      <span className='text-base-content/60 text-[0.8em]'>
                        {item.status === 'done' && _('Added to your library')}
                        {item.status === 'pending' && _('Waiting to be processed')}
                        {item.status === 'claimed' && _('Processing…')}
                        {item.status === 'failed' && (item.error || _('Failed'))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <BoxedList
            title={_('This device')}
            description={_('Download and import books emailed to your address.')}
          >
            <SettingsSwitchRow
              label={_('Process incoming items on this device')}
              checked={drainEnabled}
              onChange={toggleDrain}
            />
          </BoxedList>
        </div>
      )}
    </div>
  );
};

export default SendToReadestForm;
