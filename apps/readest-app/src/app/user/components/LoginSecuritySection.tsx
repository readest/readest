'use client';

import React, { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { UserPlan } from '@/types/quota';
import DeleteConfirmationModal from './DeleteConfirmationModal';

interface LoginSecuritySectionProps {
  userEmail: string;
  planName: string;
  userPlan: UserPlan;
  customizationPurchased: boolean;
  onResetPassword: () => void;
  onUpdateEmail: () => void;
  onConfirmDelete: () => Promise<void> | void;
}

export const LoginSecuritySection: React.FC<LoginSecuritySectionProps> = ({
  userEmail,
  planName,
  userPlan,
  customizationPurchased,
  onResetPassword,
  onUpdateEmail,
  onConfirmDelete,
}) => {
  const _ = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className='flex flex-col gap-6'>
      {confirmOpen && (
        <DeleteConfirmationModal
          key={`account:${userEmail}`}
          title={_('Delete Your Account?')}
          message={_(
            'This action cannot be undone. All your data in the cloud will be permanently deleted.',
          )}
          requireTypedConfirmation={true}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            await onConfirmDelete();
            setConfirmOpen(false);
          }}
        >
          <div className='mb-4 flex flex-col gap-2 text-sm'>
            <p className='break-words font-semibold' dir='auto'>
              {userEmail}
            </p>
            <p>{planName}</p>
            {(userPlan !== 'free' || customizationPurchased) && (
              <p className='font-semibold'>{_('This account has a paid plan or purchases.')}</p>
            )}
          </div>
        </DeleteConfirmationModal>
      )}

      <div className='flex flex-col gap-2'>
        <h3 className='text-base-content text-lg font-semibold'>{_('Login & Security')}</h3>
        <p className='text-base-content/70 text-sm'>
          {_('Manage your password, email address, and account deletion')}
        </p>
      </div>

      <div className='flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols-3'>
        <button
          onClick={onResetPassword}
          className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
        >
          {_('Change Password')}
        </button>
        <button
          onClick={onUpdateEmail}
          className='bg-base-300 hover:bg-base-content/15 text-base-content border-base-content/10 eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 md:w-auto'
        >
          {_('Change Email')}
        </button>
      </div>

      <div className='eink-bordered mt-4 flex w-full flex-col gap-3 rounded-lg border p-4 not-eink:border-error/30 sm:w-fit sm:min-w-64'>
        <h4 className='text-base-content text-sm font-semibold not-eink:text-error'>
          {_('Danger Zone')}
        </h4>
        <button
          onClick={() => setConfirmOpen(true)}
          className='eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 not-eink:border-error/40 not-eink:bg-error/10 not-eink:text-error not-eink:hover:bg-error/20'
        >
          {_('Delete Account')}
        </button>
      </div>
    </div>
  );
};
