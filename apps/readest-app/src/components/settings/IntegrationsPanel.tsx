import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Integrations')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_(
            'Readest Local keeps online integrations, cloud sync, online catalogs, translation, and send-to-device features disabled.',
          )}
        </p>
      </div>
    </div>
  );
};

export default IntegrationsPanel;
