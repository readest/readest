import { Trans } from 'react-i18next';
import { useTranslation } from '@/hooks/useTranslation';
import { stubTranslation as _ } from '@/utils/misc';
import { openExternalUrl } from '@/utils/open';
import QRCode from '@/components/settings/integrations/QRCode';

// Registers the key for extraction; it is rendered through <Trans> below.
_('Visit {{url}} and enter');

interface DeviceCodeProps {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
}

/** A device sign-in code to approve on another device: as a QR code, or as a link and a code. */
export default function DeviceCode({
  userCode,
  verificationUri,
  verificationUriComplete,
}: DeviceCodeProps) {
  const _ = useTranslation();
  return (
    <div className='flex w-full flex-col items-center gap-3 text-sm'>
      <div className='mb-3'>
        <QRCode value={verificationUriComplete} />
      </div>
      <p>{_('Scan this QR code')}</p>
      <p className='text-base-content/50'>{_('— or —')}</p>
      <p>
        <Trans
          i18nKey='Visit {{url}} and enter'
          defaults='<0>Visit </0><1>{{url}}</1><2> and enter</2>'
          values={{ url: verificationUri }}
          components={[
            <span key='0' />,
            <a
              key='1'
              className='link link-primary'
              href={verificationUriComplete}
              onClick={(e) => {
                e.preventDefault();
                openExternalUrl(verificationUriComplete);
              }}
            >
              {verificationUri}
            </a>,
            <span key='2' />,
          ]}
        />
      </p>
      <div className='font-mono text-2xl tracking-widest'>{userCode}</div>
    </div>
  );
}
