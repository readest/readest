import { IconType } from 'react-icons';
import { FiSearch } from 'react-icons/fi';
import { FiCopy } from 'react-icons/fi';
import { FiLink } from 'react-icons/fi';
import { FiShare } from 'react-icons/fi';
import { FiImage } from 'react-icons/fi';
import { PiHighlighterFill } from 'react-icons/pi';
import { LuBookA } from 'react-icons/lu';
import { BsPencilSquare } from 'react-icons/bs';
import { BsTranslate } from 'react-icons/bs';
import { RiPencilLine } from 'react-icons/ri';
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
  {
    type: 'copy',
    label: _('Copy'),
    tooltip: _('Copy text after selection'),
    Icon: FiCopy,
    quickAction: true,
  },
  {
    type: 'copylink',
    label: _('Copy Link'),
    tooltip: _('Copy link to text after selection'),
    Icon: FiLink,
  },
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
  {
    type: 'handwriting',
    label: _('Handwriting'),
    tooltip: _('Draw handwriting on the page'),
    Icon: RiPencilLine,
  },
  {
    type: 'search',
    label: _('Search'),
    tooltip: _('Search text after selection'),
    Icon: FiSearch,
    quickAction: true,
  },
  {
    type: 'dictionary',
    label: _('Dictionary'),
    tooltip: _('Look up text in dictionary after selection'),
    Icon: LuBookA,
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
  {
    type: 'share',
    label: _('Share'),
    tooltip: _('Share text after selection'),
    Icon: FiShare,
    quickAction: true,
  },
  {
    type: 'quotecard',
    label: _('Quote Card'),
    tooltip: _('Create a quote card image from the selection'),
    Icon: FiImage,
  },
]);

export const annotationToolQuickActions = annotationToolButtons.filter(
  (button) => button.quickAction,
);
