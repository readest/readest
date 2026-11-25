import { useId, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { redeemGiftCode } from '@/libs/payment/gift/client';
import { eventDispatcher } from '@/utils/event';

interface RedeemGiftFormProps {
  initialCode?: string;
  onRedeemed: () => void;
}

const RedeemGiftForm: React.FC<RedeemGiftFormProps> = ({ initialCode = '', onRedeemed }) => {
  const _ = useTranslation();
  const errorId = useId();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await redeemGiftCode(code.trim());
      setCode('');
      eventDispatcher.dispatch('toast', { type: 'info', message: _('Gift card redeemed') });
      onRedeemed();
    } catch (err) {
      // One message for invalid and used codes: the server can't tell them apart either.
      const reason = err instanceof Error ? err.message : '';
      setError(
        reason === 'invalid_or_used'
          ? _('This code is invalid or has already been used.')
          : reason === 'test_card'
            ? _("This is a test card and can't be redeemed.")
            : _('Could not redeem the code. Please try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-2'>
      <div className='flex gap-2'>
        <input
          aria-label={_('Gift code')}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          placeholder='XXXX-XXXX-XXXX-XXXX'
          dir='ltr'
          value={code}
          // The code sent is the one cleared or reported on when it answers.
          readOnly={busy}
          autoComplete='off'
          autoCapitalize='characters'
          spellCheck={false}
          onChange={(event) => {
            setCode(event.target.value);
            setError('');
          }}
          className='input eink-bordered min-w-0 flex-1 font-mono uppercase tracking-wider'
        />
        <button
          type='submit'
          disabled={busy || !code.trim()}
          aria-busy={busy}
          className='btn btn-contrast'
        >
          {busy && <span className='loading loading-spinner loading-sm' />}
          {_('Redeem')}
        </button>
      </div>
      {error && (
        <p id={errorId} role='alert' className='text-error eink:text-base-content text-[0.9em]'>
          {error}
        </p>
      )}
    </form>
  );
};

export default RedeemGiftForm;
