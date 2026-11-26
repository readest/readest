'use client';

import React, { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { UserPlan } from '@/types/quota';
import { DeleteConfirmationModal } from './AccountActions';

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

      <h3 className='text-base-content text-lg font-semibold'>{_('Login & Security')}</h3>

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

      <div className='eink-bordered mt-4 flex w-full flex-col gap-3 rounded-lg border p-4 not-eink:border-rose-200 sm:w-fit sm:min-w-64'>
        <h4 className='text-base-content text-sm font-semibold not-eink:text-rose-700'>
          {_('Danger Zone')}
        </h4>
        <button
          onClick={() => setConfirmOpen(true)}
          className='eink-bordered w-full rounded-lg border px-6 py-3 font-medium transition-colors duration-150 not-eink:border-rose-300 not-eink:bg-rose-100 not-eink:text-rose-900 not-eink:hover:bg-rose-200'
        >
          {_('Delete Account')}
        </button>
      </div>
    </div>
  );
};
