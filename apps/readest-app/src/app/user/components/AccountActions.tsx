import { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { UserPlan } from '@/types/quota';

interface DeleteConfirmationModalProps {
  show: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  show,
  onCancel,
  onConfirm,
}) => {
  const _ = useTranslation();
  if (!show) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4'>
      <div className='w-full max-w-md rounded-2xl bg-white p-6'>
        <h3 className='mb-4 text-xl font-bold text-gray-800'>{_('Delete Your Account?')}</h3>
        <p className='mb-6 text-gray-600'>
          {_(
            'This action cannot be undone. All your data in the cloud will be permanently deleted.',
          )}
        </p>
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
  onLogout: () => void;
  onResetPassword: () => void;
  onConfirmDelete: () => void;
  onRestorePurchase?: () => void;
  onManageSubscription?: () => void;
}

const AccountActions: React.FC<AccountActionsProps> = ({
  userPlan,
  onLogout,
  onResetPassword,
  onConfirmDelete,
  onRestorePurchase,
  onManageSubscription,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const handleDeleteRequest = () => {
    setShowConfirmDelete(true);
  };

  const handleCancelDelete = () => {
    setShowConfirmDelete(false);
  };

  return (
    <>
      <DeleteConfirmationModal
        show={showConfirmDelete}
        onCancel={handleCancelDelete}
        onConfirm={async () => {
          await onConfirmDelete();
          setShowConfirmDelete(false);
        }}
      />
      <div className='flex flex-col gap-4 md:flex-row md:justify-center'>
        {appService?.hasIAP ? (
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
        <button
          onClick={onResetPassword}
          className='w-full rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-800 transition-colors hover:bg-gray-300 md:w-auto'
        >
          {_('Reset Password')}
        </button>
        <button
          onClick={onLogout}
          className='w-full rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-800 transition-colors hover:bg-gray-300 md:w-auto'
        >
          {_('Sign Out')}
        </button>
        <button
          onClick={handleDeleteRequest}
          className='w-full rounded-lg bg-red-100 px-6 py-3 font-medium text-red-600 transition-colors hover:bg-red-200 md:w-auto'
        >
          {_('Delete Account')}
        </button>
      </div>
    </>
  );
};

export default AccountActions;
