import { PiScribbleLoop } from 'react-icons/pi';

import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { eventDispatcher } from '@/utils/event';
import Button from '@/components/Button';

/** Reader header button that starts drawing on the page. */
const HandwritingToggler = ({ bookKey }: { bookKey: string }) => {
  const _ = useTranslation();
  const { getViewSettings } = useReaderStore();
  const iconSize20 = useResponsiveSize(20);
  // Ink is drawn per page; a scrolled view has none to draw on.
  const scrolled = !!getViewSettings(bookKey)?.scrolled;

  return (
    <Button
      icon={<PiScribbleLoop size={iconSize20} className='text-base-content' />}
      label={_('Draw')}
      disabled={scrolled}
      onClick={() => eventDispatcher.dispatch('handwriting', { action: 'toggle', bookKey })}
    />
  );
};

export default HandwritingToggler;
