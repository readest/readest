import { useId, useState, type ReactNode } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { UserPlan } from '@/types/quota';

interface DeleteConfirmationModalProps {
  title: string;
  message: string;
  children?: ReactNode;
  requireTypedConfirmation: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  title,
  message,
  children,
  requireTypedConfirmation,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  const titleId = useId();
  const [confirmationText, setConfirmationText] = useState('');
  const canConfirm = !requireTypedConfirmation || confirmationText === 'DELETE';

  return (
    <div
      data-capture-blocking-overlay='true'
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        className='bg-base-100 eink-bordered max-h-full w-full max-w-md overflow-y-auto rounded-2xl p-6'
      >
        <h3 id={titleId} className='text-base-content mb-4 text-xl font-bold'>
          {title}
        </h3>
        {children}
        <p className='text-base-content/70 mb-6'>{message}</p>
        {requireTypedConfirmation && (
          <label className='mb-6 flex flex-col gap-2 text-sm'>
            {_('Type {{word}} to confirm', { word: 'DELETE' })}
            <input
              type='text'
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              autoComplete='off'
              autoCapitalize='off'
              spellCheck={false}
              dir='ltr'
              className='input eink-bordered w-full'
            />
          </label>
        )}
        <div className='flex flex-col gap-3 sm:flex-row'>
          <button
            onClick={onCancel}
            className='bg-base-200 hover:bg-base-300 text-base-content eink-bordered flex-1 rounded-lg px-4 py-2 font-medium transition-colors duration-150'
          >
            {_('Cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className='eink-contrast flex-1 rounded-lg px-4 py-2 font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 not-eink:bg-rose-600 not-eink:text-white not-eink:hover:bg-rose-700'
          >
            {_('Delete Permanently')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface AccountActionsProps {
  userEmail: string;
  planName: string;
  userPlan: UserPlan;
  customizationPurchased: boolean;
  iapAvailable: boolean;
  onLogout: () => void;
  onResetPassword: () => void;
  onUpdateEmail: () => void;
  onConfirmDelete: () => void;
  onConfirmDeleteAllBooks: () => void;
  onRestorePurchase?: () => void;
  onManageSubscription?: () => void;
  onManageStorage?: () => void;
  onManageSharedLinks?: () => void;
  onManageSync?: () => void;
}

const AccountActions: React.FC<AccountActionsProps> = ({
  userEmail,
  planName,
  userPlan,
  customizationPurchased,
  iapAvailable,
  onLogout,
  onResetPassword,
  onUpdateEmail,
  onConfirmDelete,
  onConfirmDeleteAllBooks,
  onRestorePurchase,
  onManageSubscription,
  onManageStorage,
  onManageSharedLinks,
  onManageSync,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [pendingAction, setPendingAction] = useState<'account' | 'books' | null>(null);

  const confirmations = {
    account: {
      title: _('Delete Your Account?'),
      message: _(
        'This action cannot be undone. All your data in the cloud will be permanently deleted.',
      ),
      onConfirm: onConfirmDelete,
    },
    books: {
      title: _('Delete All Books?'),
      message: _(
        'This action cannot be undone. Every book will be removed from this device and from your Readest cloud library, along with reading progress, bookmarks, and annotations. Books you imported in place keep their original files, and books uploaded to cloud storage stay there until you remove them under Manage Storage. Other signed-in devices keep their own copies.',
      ),
      onConfirm: onConfirmDeleteAllBooks,
    },
  };
  const confirmation = pendingAction ? confirmations[pendingAction] : null;

  return (
    <>
      {confirmation && (
        <DeleteConfirmationModal
          key={`${pendingAction}:${userEmail}`}
          title={confirmation.title}
          message={confirmation.message}
          requireTypedConfirmation={pendingAction === 'account'}
          onCancel={() => setPendingAction(null)}
          onConfirm={async () => {
            await confirmation.onConfirm();
            setPendingAction(null);
          }}
        >
          {pendingAction === 'account' && (
            <div className='mb-4 flex flex-col gap-2 text-sm'>
              <p className='break-words font-semibold' dir='auto'>
                {userEmail}
              </p>
              <p>{planName}</p>
              {(userPlan !== 'free' || customizationPurchased) && (
                <p className='font-semibold'>{_('This account has a paid plan or purchases.')}</p>
              )}
            </div>
          )}
        </DeleteConfirmationModal>
      )}
      <div className='flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols-3'>
        {appService?.hasIAP && iapAvailable ? (
          <button
            onClick={onRestorePurchase}
            className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
          >
            {_('Restore Purchase')}
          </button>
        ) : (
          userPlan !== 'free' && (
            <button
              onClick={onManageSubscription}
              className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
            >
              {_('Manage Subscription')}
            </button>
          )
        )}
        {onManageSync && (
          <button
            onClick={onManageSync}
            className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
          >
            {_('Manage Sync')}
          </button>
        )}
        {onManageStorage && (
          <button
            onClick={onManageStorage}
            className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
          >
            {_('Manage Storage')}
          </button>
        )}
        {onManageSharedLinks && (
          <button
            onClick={onManageSharedLinks}
            className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
          >
            {_('Manage Shared Links')}
          </button>
        )}
        <button
          onClick={onResetPassword}
          className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
        >
          {_('Reset Password')}
        </button>
        <button
          onClick={onUpdateEmail}
          className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
        >
          {_('Update Email')}
        </button>
        <button
          onClick={onLogout}
          className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
        >
          {_('Sign Out')}
        </button>
      </div>
      <div className='eink-bordered mt-8 flex flex-col gap-3 rounded-lg border p-4 not-eink:border-rose-200'>
        <h3 className='text-base-content text-sm font-semibold not-eink:text-rose-700'>
          {_('Danger Zone')}
        </h3>
        <div className='flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols-3'>
          <button
            onClick={() => setPendingAction('books')}
            className='eink-bordered w-full rounded-lg px-6 py-3 font-medium transition-colors duration-150 border not-eink:border-rose-300 not-eink:bg-rose-100 not-eink:text-rose-900 not-eink:hover:bg-rose-200 md:w-auto'
          >
            {_('Delete All Books')}
          </button>
          <button
            onClick={() => setPendingAction('account')}
            className='eink-bordered w-full rounded-lg px-6 py-3 font-medium transition-colors duration-150 border not-eink:border-rose-300 not-eink:bg-rose-100 not-eink:text-rose-900 not-eink:hover:bg-rose-200 md:w-auto'
          >
            {_('Delete Account')}
          </button>
        </div>
      </div>
    </>
  );
};

export default AccountActions;
