import React, { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import StatsPanel from '@/components/settings/StatsPanel';

export const setReadingStatsDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('reading_stats_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

export const ReadingStatsDialog: React.FC = () => {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('reading_stats_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <Dialog
      id='reading_stats_window'
      isOpen={isOpen}
      fullScreen={true}
      useOverlayScroll={true}
      title={_('Reading Stats')}
      onClose={handleClose}
      contentClassName='px-3! sm:px-6!'
    >
      <div className='mx-auto w-full max-w-2xl py-2 sm:py-4'>{isOpen && <StatsPanel />}</div>
    </Dialog>
  );
};

export default ReadingStatsDialog;
