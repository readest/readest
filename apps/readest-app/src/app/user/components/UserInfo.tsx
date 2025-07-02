import { PiUserCircle } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { PlanDetails } from '../utils/plan';
import UserAvatar from '@/components/UserAvatar';

interface UserInfoProps {
  avatarUrl?: string;
  userFullName: string;
  userEmail: string;
  planDetails: PlanDetails;
}

const UserInfo: React.FC<UserInfoProps> = ({ avatarUrl, userFullName, userEmail, planDetails }) => {
  const _ = useTranslation();
  return (
    <div className='flex flex-col items-center gap-x-6 gap-y-4 md:flex-row md:items-start'>
      <div className='flex-shrink-0'>
        {avatarUrl ? (
          <UserAvatar
            url={avatarUrl}
            size={window.innerWidth < 640 ? 64 : 128}
            DefaultIcon={PiUserCircle}
            className='h-16 w-16 md:h-24 md:w-24'
            borderClassName='border-base-100 border-4'
          />
        ) : (
          <PiUserCircle className='h-16 w-16 md:h-24 md:w-24' />
        )}
      </div>

      <div className='flex-grow text-center md:text-left'>
        <h2 className='text-base-content text-xl font-bold md:text-2xl'>{userFullName}</h2>
        <p className='text-base-content/60'>{userEmail}</p>
        <div className='mt-3'>
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${planDetails.color}`}
          >
            {_(planDetails.name)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default UserInfo;
