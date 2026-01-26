import { Fzf, FzfResultItem, byLengthAsc } from 'fzf';
import { SettingsPanelType } from '@/components/settings/SettingsDialog';
import { RiFontSize, RiDashboardLine, RiTranslate } from 'react-icons/ri';
import { VscSymbolColor } from 'react-icons/vsc';
import { LiaHandPointerSolid } from 'react-icons/lia';
import { IoAccessibilityOutline } from 'react-icons/io5';
import { PiRobot, PiSun, PiMoon } from 'react-icons/pi';
import { TbSunMoon } from 'react-icons/tb';
import { MdRefresh } from 'react-icons/md';
import { IconType } from 'react-icons';

export type CommandCategory = 'settings' | 'actions' | 'navigation';

export interface CommandItem {
  id: string;
  labelKey: string;
  localizedLabel: string;
  keywords: string[];
  category: CommandCategory;
  panel?: SettingsPanelType;
  section?: string;
  icon?: IconType;
  shortcut?: string[];
  action: () => void;
  isAvailable?: () => boolean;
}

export interface CommandSearchResult {
  item: CommandItem;
  score: number;
  positions: Set<number>;
  highlightIndices: Set<number>;
  matchContext?: string;
}

type TranslationFunc = (key: string) => string;

// selector for fzf - combines all searchable text
const getSearchableText = (item: CommandItem): string => {
  return [
    item.localizedLabel,
    item.labelKey,
    item.panel ?? '',
    item.section ?? '',
    ...item.keywords,
  ]
    .filter(Boolean)
    .join(' ');
};

// map fzf positions to display label positions
const mapPositionsToLabel = (entry: FzfResultItem<CommandItem>): Set<number> => {
  const searchText = getSearchableText(entry.item);
  const label = entry.item.localizedLabel;
  const labelStart = searchText.indexOf(label);

  if (labelStart === -1) return new Set();

  const labelEnd = labelStart + label.length;
  const mapped = new Set<number>();

  for (const pos of entry.positions) {
    if (pos >= labelStart && pos < labelEnd) {
      mapped.add(pos - labelStart);
    }
  }

  return mapped;
};

// find matched context from keywords/section/panel for secondary display
const findMatchContext = (entry: FzfResultItem<CommandItem>): string | undefined => {
  const searchText = getSearchableText(entry.item);
  const label = entry.item.localizedLabel;
  const labelStart = searchText.indexOf(label);
  const labelEnd = labelStart + label.length;

  // check if any match is outside the label
  for (const pos of entry.positions) {
    if (pos < labelStart || pos >= labelEnd) {
      // match is in keywords/section/panel area
      const parts = [entry.item.panel, entry.item.section, ...entry.item.keywords].filter(Boolean);
      for (const part of parts) {
        if (part && searchText.includes(part)) {
          const partStart = searchText.indexOf(part, labelEnd);
          if (partStart !== -1) {
            for (const p of entry.positions) {
              if (p >= partStart && p < partStart + part.length) {
                return part;
              }
            }
          }
        }
      }
    }
  }
  return undefined;
};

export const searchCommands = (query: string, items: CommandItem[]): CommandSearchResult[] => {
  if (!query.trim()) return [];

  const availableItems = items.filter((item) => !item.isAvailable || item.isAvailable());

  const fzf = new Fzf(availableItems, {
    selector: getSearchableText,
    tiebreakers: [byLengthAsc],
    casing: 'smart-case',
    normalize: true,
    limit: 50,
  });

  const results = fzf.find(query);

  return results.map((entry) => ({
    item: entry.item,
    score: entry.score,
    positions: entry.positions,
    highlightIndices: mapPositionsToLabel(entry),
    matchContext: findMatchContext(entry),
  }));
};

// group results by category
export const groupResultsByCategory = (
  results: CommandSearchResult[],
): Record<CommandCategory, CommandSearchResult[]> => {
  const grouped: Record<CommandCategory, CommandSearchResult[]> = {
    settings: [],
    actions: [],
    navigation: [],
  };

  for (const result of results) {
    grouped[result.item.category].push(result);
  }

  return grouped;
};

// settings panel icon map
const panelIcons: Record<SettingsPanelType, IconType> = {
  Font: RiFontSize,
  Layout: RiDashboardLine,
  Color: VscSymbolColor,
  Control: LiaHandPointerSolid,
  Language: RiTranslate,
  AI: PiRobot,
  Custom: IoAccessibilityOutline,
};

// font panel items
const fontPanelItems = [
  {
    id: 'settings.font.overrideBookFont',
    labelKey: 'Override Book Font',
    keywords: ['font', 'override', 'book', 'custom'],
    section: 'Font',
  },
  {
    id: 'settings.font.defaultFontSize',
    labelKey: 'Default Font Size',
    keywords: ['font', 'size', 'default', 'px', 'pixels', 'text'],
    section: 'Font Size',
  },
  {
    id: 'settings.font.minimumFontSize',
    labelKey: 'Minimum Font Size',
    keywords: ['font', 'size', 'minimum', 'min', 'small'],
    section: 'Font Size',
  },
  {
    id: 'settings.font.fontWeight',
    labelKey: 'Font Weight',
    keywords: ['font', 'weight', 'bold', 'light', 'thickness'],
    section: 'Font Weight',
  },
  {
    id: 'settings.font.defaultFont',
    labelKey: 'Default Font',
    keywords: ['font', 'family', 'serif', 'sans', 'default'],
    section: 'Font Family',
  },
  {
    id: 'settings.font.cjkFont',
    labelKey: 'CJK Font',
    keywords: ['font', 'cjk', 'chinese', 'japanese', 'korean', 'asian'],
    section: 'Font Family',
  },
  {
    id: 'settings.font.serifFont',
    labelKey: 'Serif Font',
    keywords: ['font', 'serif', 'family', 'typeface'],
    section: 'Font Face',
  },
  {
    id: 'settings.font.sansSerifFont',
    labelKey: 'Sans-Serif Font',
    keywords: ['font', 'sans', 'serif', 'family', 'typeface'],
    section: 'Font Face',
  },
  {
    id: 'settings.font.monospaceFont',
    labelKey: 'Monospace Font',
    keywords: ['font', 'monospace', 'mono', 'code', 'fixed', 'width'],
    section: 'Font Face',
  },
];

// layout panel items
const layoutPanelItems = [
  {
    id: 'settings.layout.overrideBookLayout',
    labelKey: 'Override Book Layout',
    keywords: ['layout', 'override', 'book', 'custom'],
    section: 'Layout',
  },
  {
    id: 'settings.layout.writingMode',
    labelKey: 'Writing Mode',
    keywords: ['writing', 'mode', 'vertical', 'horizontal', 'direction', 'rtl', 'ltr'],
    section: 'Layout',
  },
  {
    id: 'settings.layout.borderFrame',
    labelKey: 'Border Frame',
    keywords: ['border', 'frame', 'vertical', 'mode'],
    section: 'Layout',
  },
  {
    id: 'settings.layout.paragraphMargin',
    labelKey: 'Paragraph Margin',
    keywords: ['paragraph', 'margin', 'spacing', 'gap'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.lineSpacing',
    labelKey: 'Line Spacing',
    keywords: ['line', 'spacing', 'height', 'leading'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.wordSpacing',
    labelKey: 'Word Spacing',
    keywords: ['word', 'spacing', 'gap'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.letterSpacing',
    labelKey: 'Letter Spacing',
    keywords: ['letter', 'spacing', 'tracking', 'character'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.paragraphIndent',
    labelKey: 'Paragraph Indent',
    keywords: ['paragraph', 'indent', 'first', 'line'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.fullJustification',
    labelKey: 'Full Justification',
    keywords: ['justify', 'justification', 'alignment', 'text', 'full'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.hyphenation',
    labelKey: 'Hyphenation',
    keywords: ['hyphen', 'hyphenation', 'break', 'word'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.pageMargins',
    labelKey: 'Page Margins',
    keywords: ['page', 'margin', 'edge', 'border'],
    section: 'Page',
  },
  {
    id: 'settings.layout.pageGap',
    labelKey: 'Page Gap',
    keywords: ['page', 'gap', 'spacing', 'gutter'],
    section: 'Page',
  },
  {
    id: 'settings.layout.maxColumnCount',
    labelKey: 'Max Column Count',
    keywords: ['column', 'columns', 'max', 'count', 'multi'],
    section: 'Page',
  },
  {
    id: 'settings.layout.maxInlineSize',
    labelKey: 'Max Inline Size',
    keywords: ['width', 'max', 'inline', 'size', 'column'],
    section: 'Page',
  },
  {
    id: 'settings.layout.maxBlockSize',
    labelKey: 'Max Block Size',
    keywords: ['height', 'max', 'block', 'size'],
    section: 'Page',
  },
  {
    id: 'settings.layout.showHeader',
    labelKey: 'Show Header',
    keywords: ['header', 'show', 'top', 'bar', 'title'],
    section: 'Header & Footer',
  },
  {
    id: 'settings.layout.showFooter',
    labelKey: 'Show Footer',
    keywords: ['footer', 'show', 'bottom', 'bar', 'page', 'number'],
    section: 'Header & Footer',
  },
  {
    id: 'settings.layout.progressDisplay',
    labelKey: 'Progress Display',
    keywords: ['progress', 'display', 'page', 'number', 'percentage'],
    section: 'Header & Footer',
  },
];

// color panel items
const colorPanelItems = [
  {
    id: 'settings.color.themeMode',
    labelKey: 'Theme Mode',
    keywords: ['theme', 'mode', 'dark', 'light', 'auto', 'system'],
    section: 'Theme',
  },
  {
    id: 'settings.color.invertImageInDarkMode',
    labelKey: 'Invert Image In Dark Mode',
    keywords: ['invert', 'image', 'dark', 'mode', 'photo'],
    section: 'Theme',
  },
  {
    id: 'settings.color.overrideBookColor',
    labelKey: 'Override Book Color',
    keywords: ['override', 'book', 'color', 'custom'],
    section: 'Theme',
  },
  {
    id: 'settings.color.themeColor',
    labelKey: 'Theme Color',
    keywords: ['theme', 'color', 'palette', 'accent'],
    section: 'Theme',
  },
  {
    id: 'settings.color.backgroundTexture',
    labelKey: 'Background Texture',
    keywords: ['background', 'texture', 'paper', 'pattern'],
    section: 'Theme',
  },
  {
    id: 'settings.color.highlightColors',
    labelKey: 'Highlight Colors',
    keywords: ['highlight', 'color', 'annotation', 'marker'],
    section: 'Highlight',
  },
  {
    id: 'settings.color.ttsHighlightStyle',
    labelKey: 'TTS Highlight Style',
    keywords: ['tts', 'highlight', 'style', 'speech', 'read', 'aloud'],
    section: 'Highlight',
  },
  {
    id: 'settings.color.readingRuler',
    labelKey: 'Reading Ruler',
    keywords: ['reading', 'ruler', 'line', 'guide', 'focus'],
    section: 'Reading',
  },
  {
    id: 'settings.color.codeHighlighting',
    labelKey: 'Code Highlighting',
    keywords: ['code', 'highlighting', 'syntax', 'programming'],
    section: 'Code',
  },
];

// control panel items
const controlPanelItems = [
  {
    id: 'settings.control.scrolledMode',
    labelKey: 'Scrolled Mode',
    keywords: ['scroll', 'scrolled', 'mode', 'paginate', 'continuous'],
    section: 'Scroll',
  },
  {
    id: 'settings.control.continuousScroll',
    labelKey: 'Continuous Scroll',
    keywords: ['continuous', 'scroll', 'endless', 'infinite'],
    section: 'Scroll',
  },
  {
    id: 'settings.control.overlapPixels',
    labelKey: 'Overlap Pixels',
    keywords: ['overlap', 'pixels', 'scroll', 'offset'],
    section: 'Scroll',
  },
  {
    id: 'settings.control.clickToPaginate',
    labelKey: 'Click to Paginate',
    keywords: ['click', 'tap', 'paginate', 'page', 'turn'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.clickBothSides',
    labelKey: 'Click Both Sides',
    keywords: ['click', 'tap', 'both', 'sides', 'fullscreen'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.swapClickSides',
    labelKey: 'Swap Click Sides',
    keywords: ['swap', 'click', 'tap', 'sides', 'reverse'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.disableDoubleClick',
    labelKey: 'Disable Double Click',
    keywords: ['disable', 'double', 'click', 'tap'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.enableQuickActions',
    labelKey: 'Enable Quick Actions',
    keywords: ['quick', 'actions', 'annotation', 'enable'],
    section: 'Annotation Tools',
  },
  {
    id: 'settings.control.quickAction',
    labelKey: 'Quick Action',
    keywords: ['quick', 'action', 'annotation', 'highlight', 'copy'],
    section: 'Annotation Tools',
  },
  {
    id: 'settings.control.copyToNotebook',
    labelKey: 'Copy to Notebook',
    keywords: ['copy', 'notebook', 'annotation', 'excerpt'],
    section: 'Annotation Tools',
  },
  {
    id: 'settings.control.pagingAnimation',
    labelKey: 'Paging Animation',
    keywords: ['paging', 'animation', 'transition', 'effect'],
    section: 'Animation',
  },
  {
    id: 'settings.control.einkMode',
    labelKey: 'E-Ink Mode',
    keywords: ['eink', 'e-ink', 'kindle', 'e-reader', 'epaper'],
    section: 'Device',
  },
  {
    id: 'settings.control.colorEinkMode',
    labelKey: 'Color E-Ink Mode',
    keywords: ['color', 'eink', 'e-ink', 'kaleido'],
    section: 'Device',
  },
  {
    id: 'settings.control.allowJavascript',
    labelKey: 'Allow JavaScript',
    keywords: ['javascript', 'js', 'script', 'security', 'allow'],
    section: 'Security',
  },
];

// language panel items
const languagePanelItems = [
  {
    id: 'settings.language.interfaceLanguage',
    labelKey: 'Interface Language',
    keywords: ['interface', 'language', 'locale', 'ui', 'translation'],
    section: 'Language',
  },
  {
    id: 'settings.language.translationEnabled',
    labelKey: 'Enable Translation',
    keywords: ['translation', 'translate', 'enable', 'language'],
    section: 'Translation',
  },
  {
    id: 'settings.language.translationProvider',
    labelKey: 'Translation Provider',
    keywords: ['translation', 'provider', 'google', 'deepl', 'service'],
    section: 'Translation',
  },
  {
    id: 'settings.language.targetLanguage',
    labelKey: 'Target Language',
    keywords: ['target', 'language', 'translation', 'destination'],
    section: 'Translation',
  },
  {
    id: 'settings.language.ttsTextTranslation',
    labelKey: 'TTS Text Translation',
    keywords: ['tts', 'text', 'translation', 'speech', 'read'],
    section: 'Translation',
  },
  {
    id: 'settings.language.quotationMarks',
    labelKey: 'Quotation Marks',
    keywords: ['quotation', 'marks', 'quotes', 'punctuation', 'cjk'],
    section: 'Punctuation',
  },
  {
    id: 'settings.language.chineseConversion',
    labelKey: 'Chinese Conversion',
    keywords: ['chinese', 'conversion', 'simplified', 'traditional', 'cjk'],
    section: 'Chinese',
  },
];

// ai panel items
const aiPanelItems = [
  {
    id: 'settings.ai.enableAssistant',
    labelKey: 'Enable AI Assistant',
    keywords: ['ai', 'assistant', 'enable', 'chatbot', 'llm'],
    section: 'AI',
  },
  {
    id: 'settings.ai.provider',
    labelKey: 'AI Provider',
    keywords: ['ai', 'provider', 'ollama', 'gateway', 'service'],
    section: 'AI',
  },
  {
    id: 'settings.ai.ollamaUrl',
    labelKey: 'Ollama URL',
    keywords: ['ollama', 'url', 'server', 'endpoint', 'api'],
    section: 'Ollama',
  },
  {
    id: 'settings.ai.ollamaModel',
    labelKey: 'Ollama Model',
    keywords: ['ollama', 'model', 'llama', 'mistral', 'gemma'],
    section: 'Ollama',
  },
  {
    id: 'settings.ai.gatewayApiKey',
    labelKey: 'API Key',
    keywords: ['api', 'key', 'gateway', 'token', 'secret'],
    section: 'AI Gateway',
  },
  {
    id: 'settings.ai.gatewayModel',
    labelKey: 'AI Gateway Model',
    keywords: ['gateway', 'model', 'openai', 'gpt', 'claude'],
    section: 'AI Gateway',
  },
];

// custom panel items
const customPanelItems = [
  {
    id: 'settings.custom.contentCss',
    labelKey: 'Custom Content CSS',
    keywords: ['custom', 'css', 'content', 'style', 'book'],
    section: 'Custom CSS',
  },
  {
    id: 'settings.custom.readerUiCss',
    labelKey: 'Custom Reader UI CSS',
    keywords: ['custom', 'css', 'reader', 'ui', 'interface'],
    section: 'Custom CSS',
  },
];

export interface CommandRegistryOptions {
  _: TranslationFunc;
  openSettingsPanel: (panel: SettingsPanelType, itemId?: string) => void;
  toggleTheme: () => void;
  toggleFullscreen: () => void;
  toggleAlwaysOnTop: () => void;
  toggleScreenWakeLock: () => void;
  toggleAutoUpload: () => void;
  reloadPage: () => void;
  toggleOpenLastBooks: () => void;
  showAbout: () => void;
  toggleTelemetry: () => void;
  isDesktop: boolean;
  // TODO: add reader-specific actions when reader is open (tts, bookmark, etc.)
}

export const buildCommandRegistry = (options: CommandRegistryOptions): CommandItem[] => {
  const { _, openSettingsPanel, isDesktop } = options;
  const items: CommandItem[] = [];

  // helper to create settings item
  const createSettingsItem = (
    def: { id: string; labelKey: string; keywords: string[]; section?: string },
    panel: SettingsPanelType,
  ): CommandItem => ({
    id: def.id,
    labelKey: def.labelKey,
    localizedLabel: _(def.labelKey),
    keywords: def.keywords,
    category: 'settings',
    panel,
    section: def.section,
    icon: panelIcons[panel],
    action: () => openSettingsPanel(panel, def.id),
  });

  // add font panel items
  for (const def of fontPanelItems) {
    items.push(createSettingsItem(def, 'Font'));
  }

  // add layout panel items
  for (const def of layoutPanelItems) {
    items.push(createSettingsItem(def, 'Layout'));
  }

  // add color panel items
  for (const def of colorPanelItems) {
    items.push(createSettingsItem(def, 'Color'));
  }

  // add control panel items
  for (const def of controlPanelItems) {
    items.push(createSettingsItem(def, 'Control'));
  }

  // add language panel items
  for (const def of languagePanelItems) {
    items.push(createSettingsItem(def, 'Language'));
  }

  // add ai panel items (only in dev, as of now atleast)
  if (process.env.NODE_ENV !== 'production') {
    for (const def of aiPanelItems) {
      items.push(createSettingsItem(def, 'AI'));
    }
  }

  // add custom panel items
  for (const def of customPanelItems) {
    items.push(createSettingsItem(def, 'Custom'));
  }

  // add action items
  const getThemeIcon = (): IconType => {
    const themeMode =
      typeof localStorage !== 'undefined' ? localStorage.getItem('themeMode') : 'auto';
    return themeMode === 'dark' ? PiMoon : themeMode === 'light' ? PiSun : TbSunMoon;
  };

  items.push({
    id: 'action.toggleTheme',
    labelKey: 'Toggle Theme Mode',
    localizedLabel: _('Toggle Theme Mode'),
    keywords: ['theme', 'dark', 'light', 'auto', 'mode', 'toggle'],
    category: 'actions',
    icon: getThemeIcon(),
    action: options.toggleTheme,
  });

  items.push({
    id: 'action.fullscreen',
    labelKey: 'Fullscreen',
    localizedLabel: _('Fullscreen'),
    keywords: ['fullscreen', 'full', 'screen', 'maximize', 'window'],
    category: 'actions',
    action: options.toggleFullscreen,
    isAvailable: () => isDesktop,
  });

  items.push({
    id: 'action.alwaysOnTop',
    labelKey: 'Always on Top',
    localizedLabel: _('Always on Top'),
    keywords: ['always', 'top', 'pin', 'window', 'float'],
    category: 'actions',
    action: options.toggleAlwaysOnTop,
    isAvailable: () => isDesktop,
  });

  items.push({
    id: 'action.screenWakeLock',
    labelKey: 'Keep Screen Awake',
    localizedLabel: _('Keep Screen Awake'),
    keywords: ['screen', 'wake', 'lock', 'awake', 'sleep', 'display'],
    category: 'actions',
    action: options.toggleScreenWakeLock,
  });

  items.push({
    id: 'action.autoUpload',
    labelKey: 'Auto Upload Books to Cloud',
    localizedLabel: _('Auto Upload Books to Cloud'),
    keywords: ['auto', 'upload', 'cloud', 'sync', 'backup'],
    category: 'actions',
    action: options.toggleAutoUpload,
  });

  items.push({
    id: 'action.reload',
    labelKey: 'Reload Page',
    localizedLabel: _('Reload Page'),
    keywords: ['reload', 'refresh', 'page'],
    category: 'actions',
    icon: MdRefresh,
    action: options.reloadPage,
  });

  items.push({
    id: 'action.openLastBooks',
    labelKey: 'Open Last Book on Start',
    localizedLabel: _('Open Last Book on Start'),
    keywords: ['open', 'last', 'book', 'start', 'resume'],
    category: 'actions',
    action: options.toggleOpenLastBooks,
    isAvailable: () => isDesktop,
  });

  items.push({
    id: 'action.about',
    labelKey: 'About Readest',
    localizedLabel: _('About Readest'),
    keywords: ['about', 'readest', 'version', 'info'],
    category: 'actions',
    action: options.showAbout,
  });

  items.push({
    id: 'action.telemetry',
    labelKey: 'Help improve Readest',
    localizedLabel: _('Help improve Readest'),
    keywords: ['telemetry', 'analytics', 'improve', 'statistics'],
    category: 'actions',
    action: options.toggleTelemetry,
  });

  return items;
};

// category labels for display
export const getCategoryLabel = (_: TranslationFunc, category: CommandCategory): string => {
  switch (category) {
    case 'settings':
      return _('Settings');
    case 'actions':
      return _('Actions');
    case 'navigation':
      return _('Navigation');
    default:
      return category;
  }
};

// get recent commands from localStorage
export const getRecentCommands = (items: CommandItem[], limit = 5): CommandItem[] => {
  if (typeof localStorage === 'undefined') return [];

  try {
    const recentIds = JSON.parse(localStorage.getItem('recentCommands') || '[]') as string[];
    return recentIds
      .slice(0, limit)
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is CommandItem => item !== undefined);
  } catch {
    return [];
  }
};

// track command usage for recent list
export const trackCommandUsage = (commandId: string): void => {
  if (typeof localStorage === 'undefined') return;

  try {
    const recentIds = JSON.parse(localStorage.getItem('recentCommands') || '[]') as string[];
    const updated = [commandId, ...recentIds.filter((id) => id !== commandId)].slice(0, 10);
    localStorage.setItem('recentCommands', JSON.stringify(updated));
  } catch {
    // ignore errors
  }
};
