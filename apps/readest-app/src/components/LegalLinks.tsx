import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import Link from './Link';

const LegalLinks = () => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const termsUrl =
    appService?.isIOSApp || appService?.isMacOSApp
      ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'
      : 'https://readest.com/terms-of-service';

  return (
    <div className='my-2 flex flex-wrap justify-center gap-4 text-xs'>
      <Link href={termsUrl} className='text-blue-500 underline hover:text-blue-600'>
        {_('Terms of Service')}
      </Link>
      <Link
        href='https://readest.com/privacy-policy'
        className='text-blue-500 underline hover:text-blue-600'
      >
        {_('Privacy Policy')}
      </Link>
    </div>
  );
};

export default LegalLinks;
