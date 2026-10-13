import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { ensureCustomTTSServicesLoaded, useCustomTTSStore } from '@/store/customTTSStore';
import { BoxedList, NavigationRow } from './primitives';
import { AddButton } from './CustomTranslators';
import SubPageHeader from './SubPageHeader';
import CustomTTSServiceEditor from './CustomTTSServiceEditor';

// undefined: the list; null: a new service; a string: that service.
type Editing = string | null | undefined;

const CustomTTSServices: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [editing, setEditing] = useState<Editing>(undefined);
  const services = useCustomTTSStore((s) => s.services).filter((s) => !s.deletedAt);
  const backToList = () => setEditing(undefined);

  useEffect(() => {
    ensureCustomTTSServicesLoaded(envConfig);
  }, [envConfig]);

  // Esc / Android Back steps out of the editor before leaving this sub-page.
  useKeyDownActions({ enabled: editing !== undefined, onCancel: backToList });

  if (editing !== undefined) {
    return (
      <CustomTTSServiceEditor
        key={editing ?? 'new'}
        service={services.find((s) => s.id === editing)}
        onBack={backToList}
      />
    );
  }

  return (
    <div className='my-4 w-full space-y-6'>
      <SubPageHeader
        parentLabel={_('TTS')}
        currentLabel={_('Custom TTS Services')}
        description={_(
          'Read aloud with your own OpenAI-compatible speech service, such as OpenAI or a self-hosted Kokoro server. Its voices appear in the voice list for every book.',
        )}
        onBack={onBack}
      />
      <div className='space-y-2'>
        {services.length > 0 && (
          <BoxedList cardClassName='overflow-hidden'>
            {services.map((s) => (
              <NavigationRow
                key={s.id}
                title={s.name}
                status={[s.model, s.disabled ? _('Disabled') : ''].filter(Boolean).join(' · ')}
                onClick={() => setEditing(s.id)}
              />
            ))}
          </BoxedList>
        )}
        <div className='grid grid-cols-1'>
          <AddButton label={_('Add TTS Service')} onClick={() => setEditing(null)} />
        </div>
      </div>
    </div>
  );
};

export default CustomTTSServices;
