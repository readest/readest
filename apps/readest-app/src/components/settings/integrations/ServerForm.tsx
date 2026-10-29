import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import SubPageHeader from '../SubPageHeader';
import ServerSettings from './ServerSettings';

interface ServerFormProps {
  onBack: () => void;
}

const ServerForm: React.FC<ServerFormProps> = ({ onBack }) => {
  const _ = useTranslation();
  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('Readest Server')}
        description={_('Choose Readest Cloud or connect to your own self-hosted server')}
        onBack={onBack}
      />
      <ServerSettings />
    </div>
  );
};

export default ServerForm;
