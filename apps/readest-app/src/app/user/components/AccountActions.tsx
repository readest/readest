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
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4'>
      <div className='w-full max-w-md rounded-2xl bg-white p-6'>
        <h3 className='mb-4 text-xl font-bold text-gray-800'>{title}</h3>
        <p className='mb-6 text-gray-600'>{message}</p>
        <div className='flex flex-col gap-3 sm:flex-row'>
          <button
            onClick={onCancel}
            className='flex-1 rounded-lg bg-gray-300 px-4 py-2 font-medium text-gray-800 hover:bg-gray-400'
          >
            {_('Cancel')}
          </button>
          <button
            onClick={onConfirm}
            className='flex-1 rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600'
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
            className='w-full rounded-lg bg-blue-100 px-6 py-3 font-medium text-blue-600 transition-colors hover:bg-blue-200 md:w-auto'
          >
            {_('Restore Purchase')}
          </button>
        ) : (
          userPlan !== 'free' && (
            <button
              onClick={onManageSubscription}
              className='w-full rounded-lg bg-blue-100 px-6 py-3 font-medium text-blue-600 transition-colors hover:bg-blue-200 md:w-auto'
            >
              {_('Manage Subscription')}
            </button>
          )
        )}
        {onManageSync && (
          <button
            onClick={onManageSync}
            className='w-full rounded-lg bg-blue-100 px-6 py-3 font-medium text-blue-600 transition-colors hover:bg-blue-200 md:w-auto'
          >
            {_('Manage Sync')}
          </button>
        )}
        {onManageStorage && (
          <button
            onClick={onManageStorage}
            className='w-full rounded-lg bg-purple-100 px-6 py-3 font-medium text-purple-600 transition-colors hover:bg-purple-200 md:w-auto'
          >
            {_('Manage Storage')}
          </button>
        )}
        {onManageSharedLinks && (
          <button
            onClick={onManageSharedLinks}
            className='w-full rounded-lg bg-purple-100 px-6 py-3 font-medium text-purple-600 transition-colors hover:bg-purple-200 md:w-auto'
          >
            {_('Manage Shared Links')}
          </button>
        )}
        <button
          onClick={onResetPassword}
          className='w-full rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-800 transition-colors hover:bg-gray-300 md:w-auto'
        >
          {_('Reset Password')}
        </button>
        <button
          onClick={onUpdateEmail}
          className='w-full rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-800 transition-colors hover:bg-gray-300 md:w-auto'
        >
          {_('Update Email')}
        </button>
        <button
          onClick={onLogout}
          className='w-full rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-800 transition-colors hover:bg-gray-300 md:w-auto'
        >
          {_('Sign Out')}
        </button>
      </div>
      <div className='mt-8 flex flex-col gap-3 rounded-lg border border-red-200 p-4'>
        <h3 className='text-sm font-semibold text-red-600'>{_('Danger Zone')}</h3>
        <div className='flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols-3'>
          <button
            onClick={() => setPendingAction('books')}
            className='w-full rounded-lg bg-red-100 px-6 py-3 font-medium text-red-600 transition-colors hover:bg-red-200 md:w-auto'
          >
            {_('Delete All Books')}
          </button>
          <button
            onClick={() => setPendingAction('account')}
            className='w-full rounded-lg bg-red-100 px-6 py-3 font-medium text-red-600 transition-colors hover:bg-red-200 md:w-auto'
          >
            {_('Delete Account')}
          </button>
        </div>
      </div>
    </>
  );
};

export default AccountActions;
