import { useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import ServerSettings, {
  getActiveServerHost,
} from '@/components/settings/integrations/ServerSettings';

/**
 * Names the server the native app signs in to and lets the user change it
 * before signing in, so a fresh install is never stuck on Readest Cloud.
 */
const ServerIndicator: React.FC = () => {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const host = getActiveServerHost() ?? _('Readest Cloud');

  return (
    <>
      <button
        type='button'
        onClick={() => setIsOpen(true)}
        className='text-base-content/70 hover:text-base-content min-h-11 text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
      >
        {_('Server: {{host}}', { host })}
      </button>
      <Dialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={_('Readest Server')}
        aboveKeyboard
      >
        <div className='p-4 sm:p-6'>
          <ServerSettings />
        </div>
      </Dialog>
    </>
  );
};

export default ServerIndicator;
