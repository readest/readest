import { stubTranslation as _ } from '@/utils/misc';

export const FILE_REVEAL_LABELS = {
  macos: _('Reveal in Finder'),
  windows: _('Reveal in File Explorer'),
  linux: _('Reveal in Folder'),
  default: _('Reveal in Folder'),
};

export type FILE_REVEAL_PLATFORMS = keyof typeof FILE_REVEAL_LABELS;
