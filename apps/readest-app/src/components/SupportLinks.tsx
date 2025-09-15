import { FaGithub, FaDiscord, FaReddit } from 'react-icons/fa';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Link from './Link';

const SupportLinks = () => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);

  return (
    <div className='my-2 flex flex-col items-center gap-2'>
      <p className='text-neutral-content text-sm'>{_('Get Help from the Readest Community')}</p>
      <div className='flex gap-4'>
        <Link
          href='https://github.com/readest/readest'
          className='flex items-center gap-2 rounded-full bg-gray-800 p-1.5 text-white transition-colors hover:bg-gray-700'
          title='GitHub'
          aria-label='GitHub'
        >
          <FaGithub size={iconSize} />
        </Link>
        <Link
          href='https://discord.gg/gntyVNk3BJ'
          className='flex items-center gap-2 rounded-full bg-indigo-600 p-1.5 text-white transition-colors hover:bg-indigo-500'
          title='Discord'
          aria-label='Discord'
        >
          <FaDiscord size={iconSize} />
        </Link>
        <Link
          href='https://reddit.com/r/readest/'
          className='flex items-center gap-2 rounded-full bg-orange-600 p-1.5 text-white transition-colors hover:bg-orange-500'
          title='Reddit'
          aria-label='Reddit'
        >
          <FaReddit size={iconSize} />
        </Link>
      </div>
    </div>
  );
};

export default SupportLinks;
