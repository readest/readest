import React from 'react';
import { LuBookOpen, LuFile } from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useDuoPose } from '@/hooks/useDuoPose';
import { saveViewSettings } from '@/helpers/settings';
import { useThemeStore } from '@/store/themeStore';
import { isDuoPartlyFolded } from '@/utils/duo';
import { eventDispatcher } from '@/utils/event';
import Button from '@/components/Button';

interface DuoBookModeTogglerProps {
  bookKey: string;
}

/**
 * iPhone Duo, inner display in landscape: switch between two pages, one on
 * each side of the hinge, and a single page. Renders nothing in any other
 * pose or on any other device.
 */
const DuoBookModeToggler: React.FC<DuoBookModeTogglerProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  // Scalars, not the settings object: saveViewSettings updates it in place.
  const bookMode = useReaderStore((s) => s.viewStates[bookKey]?.viewSettings?.duoBookMode ?? true);
  const vertical = useReaderStore((s) => !!s.viewStates[bookKey]?.viewSettings?.vertical);
  const foldedBookMode = useReaderStore(
    (s) => s.viewStates[bookKey]?.viewSettings?.duoFoldedBookMode ?? true,
  );
  const partlyFolded = useThemeStore((s) => isDuoPartlyFolded(s.duoFold));
  const pose = useDuoPose();
  const iconSize18 = useResponsiveSize(18);

  // Part way folded, two pages are forced, so the switch would do nothing.
  if (pose !== 'inner-landscape' || vertical || (foldedBookMode && partlyFolded)) return null;

  const toggleBookMode = () => {
    saveViewSettings(envConfig, bookKey, 'duoBookMode', !bookMode, false, false);
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: bookMode ? _('One page') : _('Two pages'),
      timeout: 1500,
    });
  };

  return (
    <Button
      icon={
        bookMode ? (
          <LuBookOpen className='text-base-content' size={iconSize18} />
        ) : (
          <LuFile className='text-base-content' size={iconSize18} />
        )
      }
      onClick={toggleBookMode}
      label={bookMode ? _('Show One Page') : _('Show Two Pages')}
    ></Button>
  );
};

export default DuoBookModeToggler;
