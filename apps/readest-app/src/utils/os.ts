export const FILE_REVEAL_LABELS = {
  macos: 'Reveal in Finder',
  windows: 'Reveal in File Explorer',
  linux: 'Reveal in Folder',
  default: 'Reveal in Folder',
};

export type FILE_REVEAL_PLATFORMS = keyof typeof FILE_REVEAL_LABELS;
