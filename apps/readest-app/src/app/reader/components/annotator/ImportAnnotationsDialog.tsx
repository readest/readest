import React from 'react';
import { MdDataObject, MdNightlightRound } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { BoxedList, NavigationRow } from '@/components/settings/primitives';
import Dialog from '@/components/Dialog';

interface ImportAnnotationsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportMoonReader: () => void;
  onImportReadest: () => void;
}

/**
 * Dedicated modal listing the annotation-import sources. Each source is a
 * boxed-list row; new providers (Calibre, KOReader, …) are added by dropping
 * another `<NavigationRow>` here and wiring its callback in the Annotator.
 */
const ImportAnnotationsDialog: React.FC<ImportAnnotationsDialogProps> = ({
  isOpen,
  onClose,
  onImportMoonReader,
  onImportReadest,
}) => {
  const _ = useTranslation();

  return (
    <Dialog
      isOpen={isOpen}
      title={_('Import Annotations')}
      onClose={onClose}
      boxClassName='sm:!h-auto sm:!max-h-[90vh] sm:!w-[420px]'
      contentClassName='sm:!px-6'
    >
      <BoxedList
        title={_('Import From')}
        description={_('Import highlights and notes exported from Readest or another reading app.')}
      >
        <NavigationRow
          icon={MdDataObject}
          title={_('Readest')}
          status={_('Readest annotations file (.json)')}
          onClick={onImportReadest}
        />
        <NavigationRow
          icon={MdNightlightRound}
          title={_('Moon+ Reader')}
          status={_('Moon+ Reader export file (.mrexpt)')}
          onClick={onImportMoonReader}
        />
      </BoxedList>
    </Dialog>
  );
};

export default ImportAnnotationsDialog;
