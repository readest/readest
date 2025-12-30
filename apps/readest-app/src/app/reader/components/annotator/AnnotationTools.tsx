import { IconType } from 'react-icons';
import { FiSearch } from 'react-icons/fi';
import { FiCopy } from 'react-icons/fi';
import { PiHighlighterFill } from 'react-icons/pi';
import { FaWikipediaW } from 'react-icons/fa';
import { BsPencilSquare } from 'react-icons/bs';
import { BsTranslate } from 'react-icons/bs';
import { TbHexagonLetterD } from 'react-icons/tb';
import { FaHeadphones } from 'react-icons/fa6';
import { IoIosBuild } from 'react-icons/io';
import { AnnotationToolType } from '@/types/annotator';
import { stubTranslation as _ } from '@/utils/misc';

type AnnotationToolButton = {
  type: AnnotationToolType;
  label: string;
  tooltip: string;
  Icon: IconType;
  quickAction?: boolean;
};

function createAnnotationToolButtons<T extends AnnotationToolType>(
  buttons: AnnotationToolType extends T
    ? {
        [K in T]: {
          type: K;
          label: string;
          tooltip: string;
          Icon: IconType;
          quickAction?: boolean;
        };
      }[T][]
    : never,
): AnnotationToolButton[] {
  return buttons;
}

export const annotationToolButtons = createAnnotationToolButtons([
  { type: 'copy', label: _('Copy'), tooltip: _('Copy text after selection'), Icon: FiCopy },
  {
    type: 'highlight',
    label: _('Highlight'),
    tooltip: _('Highlight text after selection'),
    Icon: PiHighlighterFill,
    quickAction: true,
  },
  {
    type: 'annotate',
    label: _('Annotate'),
    tooltip: _('Annotate text after selection'),
    Icon: BsPencilSquare,
  },
  { type: 'search', label: _('Search'), tooltip: _('Search text after selection'), Icon: FiSearch },
  {
    type: 'dictionary',
    label: _('Dictionary'),
    tooltip: _('Look up text in dictionary after selection'),
    Icon: TbHexagonLetterD,
    quickAction: true,
  },
  {
    type: 'wikipedia',
    label: _('Wikipedia'),
    tooltip: _('Look up text in Wikipedia after selection'),
    Icon: FaWikipediaW,
    quickAction: true,
  },
  {
    type: 'translate',
    label: _('Translate'),
    tooltip: _('Translate text after selection'),
    Icon: BsTranslate,
    quickAction: true,
  },
  {
    type: 'tts',
    label: _('Speak'),
    tooltip: _('Read text aloud after selection'),
    Icon: FaHeadphones,
    quickAction: true,
  },
  {
    type: 'proofread',
    label: _('Proofread'),
    tooltip: _('Proofread text after selection'),
    Icon: IoIosBuild,
  },
]);

export const annotationToolQuickActions = annotationToolButtons.filter(
  (button) => button.quickAction,
);
