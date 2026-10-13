import { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { UserPlan } from '@/types/quota';

interface DeleteConfirmationModalProps {
  show: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  show,
  title,
  message,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  if (!show) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
      <div className='bg-base-100 eink-bordered w-full max-w-md rounded-2xl p-6'>
        <h3 className='text-base-content mb-4 text-xl font-bold'>{title}</h3>
        <p className='text-base-content/70 mb-6'>{message}</p>
        <div className='flex flex-col gap-3 sm:flex-row'>
          <button
            onClick={onCancel}
            className='bg-base-200 hover:bg-base-300 text-base-content eink-bordered flex-1 rounded-lg px-4 py-2 font-medium transition-colors duration-150'
          >
            {_('Cancel')}
          </button>
          <button
            onClick={onConfirm}
            className='eink-contrast flex-1 rounded-lg px-4 py-2 font-medium transition-colors duration-150 not-eink:bg-rose-600 not-eink:text-white not-eink:hover:bg-rose-700'
          >
            {_('Delete Permanently')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface AccountActionsProps {
  userPlan: UserPlan;
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
  userPlan,
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
      <DeleteConfirmationModal
        show={!!confirmation}
        title={confirmation?.title ?? ''}
        message={confirmation?.message ?? ''}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          await confirmation?.onConfirm();
          setPendingAction(null);
        }}
      />
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
