import clsx from 'clsx';
import Image from 'next/image';
import { IconType } from 'react-icons';

interface UserAvatarProps {
  url: string;
  size: number;
  DefaultIcon: IconType;
  className?: string;
  borderClassName?: string;
}

const UserAvatar: React.FC<UserAvatarProps> = ({
  url,
  size,
  className,
  borderClassName,
  DefaultIcon,
}) => {
  return (
    <div
      className='relative flex h-full w-full items-center justify-center rounded-full'
      style={{ width: size, height: size }}
    >
      {url ? (
        <div>
          <Image
            src={url}
            alt='User Avatar'
            className={clsx('rounded-full', className, borderClassName)}
            referrerPolicy='no-referrer'
            width={size}
            height={size}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('invisible');
            }}
          />
          <div className='invisible absolute inset-0 flex items-center justify-center'>
            <DefaultIcon className={clsx('text-neutral-content', className)} />
          </div>
        </div>
      ) : (
        <DefaultIcon className='text-neutral-content' size={size} />
      )}
    </div>
  );
};

export default UserAvatar;
