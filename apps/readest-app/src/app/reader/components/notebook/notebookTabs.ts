import type { IconType } from 'react-icons';
import { LuBookA, LuScanSearch } from 'react-icons/lu';
import { PiNotePencil, PiRobot } from 'react-icons/pi';
import { RiQuillPenLine } from 'react-icons/ri';

import type { TranslationFunc } from '@/hooks/useTranslation';
import type { NotebookTab } from '@/store/notebookStore';

interface NotebookTabInfo {
  // The tab's button in the tab bar.
  label: string;
  icon: IconType;
  // The sidebar header while the tab is open.
  title: string;
  titleIcon: IconType;
  // The tab's settings, opened from a gear in the sidebar header.
  settings?: { id: string; label: string };
}

export const getNotebookTabs = (_: TranslationFunc): Record<NotebookTab, NotebookTabInfo> => ({
  notes: { label: _('Notes'), icon: PiNotePencil, title: _('Notebook'), titleIcon: RiQuillPenLine },
  ai: { label: _('AI'), icon: PiRobot, title: _('AI Assistant'), titleIcon: PiRobot },
  dictionary: {
    label: _('Dictionary'),
    icon: LuBookA,
    title: _('Dictionary'),
    titleIcon: LuBookA,
    settings: { id: 'settings.language.dictionaries.manage', label: _('Manage Dictionaries') },
  },
  xray: { label: _('X-Ray'), icon: LuScanSearch, title: _('X-Ray'), titleIcon: LuScanSearch },
});
