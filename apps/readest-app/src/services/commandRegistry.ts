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
import { stubTranslation as _ } from '@/utils/misc';

export type CommandCategory = 'settings' | 'actions' | 'navigation';

export interface CommandItem {
  id: string;
  labelKey: string;
  localizedLabel: string;
  keywords: string[];
  category: CommandCategory;
  panel?: SettingsPanelType;
  panelLabel?: string;
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
    item.panelLabel ?? '',
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
      const parts = [
        entry.item.panelLabel ?? entry.item.panel,
        entry.item.section,
        ...entry.item.keywords,
      ].filter(Boolean);
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
    labelKey: _('Override Book Font'),
    keywords: ['font', 'override', 'book', 'custom'],
    section: 'Font',
  },
  {
    id: 'settings.font.defaultFontSize',
    labelKey: _('Default Font Size'),
    keywords: ['font', 'size', 'default', 'px', 'pixels', 'text'],
    section: 'Font Size',
  },
  {
    id: 'settings.font.minimumFontSize',
    labelKey: _('Minimum Font Size'),
    keywords: ['font', 'size', 'minimum', 'min', 'small'],
    section: 'Font Size',
  },
  {
    id: 'settings.font.fontWeight',
    labelKey: _('Font Weight'),
    keywords: ['font', 'weight', 'bold', 'light', 'thickness'],
    section: 'Font Weight',
  },
  {
    id: 'settings.font.defaultFont',
    labelKey: _('Default Font'),
    keywords: ['font', 'family', 'serif', 'sans', 'default'],
    section: 'Font Family',
  },
  {
    id: 'settings.font.cjkFont',
    labelKey: _('CJK Font'),
    keywords: ['font', 'cjk', 'chinese', 'japanese', 'korean', 'asian'],
    section: 'Font Family',
  },
  {
    id: 'settings.font.serifFont',
    labelKey: _('Serif Font'),
    keywords: ['font', 'serif', 'family', 'typeface'],
    section: 'Font Face',
  },
  {
    id: 'settings.font.sansSerifFont',
    labelKey: _('Sans-Serif Font'),
    keywords: ['font', 'sans', 'serif', 'family', 'typeface'],
    section: 'Font Face',
  },
  {
    id: 'settings.font.monospaceFont',
    labelKey: _('Monospace Font'),
    keywords: ['font', 'monospace', 'mono', 'code', 'fixed', 'width'],
    section: 'Font Face',
  },
];

// layout panel items
const layoutPanelItems = [
  {
    id: 'settings.layout.overrideBookLayout',
    labelKey: _('Override Book Layout'),
    keywords: ['layout', 'override', 'book', 'custom'],
    section: 'Layout',
  },
  {
    id: 'settings.layout.writingMode',
    labelKey: _('Writing Mode'),
    keywords: ['writing', 'mode', 'vertical', 'horizontal', 'direction', 'rtl', 'ltr'],
    section: 'Layout',
  },
  {
    id: 'settings.layout.borderFrame',
    labelKey: _('Border Frame'),
    keywords: ['border', 'frame', 'vertical', 'mode'],
    section: 'Layout',
  },
  {
    id: 'settings.layout.paragraphMargin',
    labelKey: _('Paragraph Margin'),
    keywords: ['paragraph', 'margin', 'spacing', 'gap'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.lineSpacing',
    labelKey: _('Line Spacing'),
    keywords: ['line', 'spacing', 'height', 'leading'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.wordSpacing',
    labelKey: _('Word Spacing'),
    keywords: ['word', 'spacing', 'gap'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.letterSpacing',
    labelKey: _('Letter Spacing'),
    keywords: ['letter', 'spacing', 'tracking', 'character'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.paragraphIndent',
    labelKey: _('Text Indent'),
    keywords: ['paragraph', 'indent', 'first', 'line'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.fullJustification',
    labelKey: _('Full Justification'),
    keywords: ['justify', 'justification', 'alignment', 'text', 'full'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.hyphenation',
    labelKey: _('Hyphenation'),
    keywords: ['hyphen', 'hyphenation', 'break', 'word'],
    section: 'Paragraph',
  },
  {
    id: 'settings.layout.pageMargins',
    labelKey: _('Page Margins'),
    keywords: ['page', 'margin', 'edge', 'border'],
    section: 'Page',
  },
  {
    id: 'settings.layout.pageGap',
    labelKey: _('Column Gap (%)'),
    keywords: ['page', 'gap', 'spacing', 'gutter'],
    section: 'Page',
  },
  {
    id: 'settings.layout.maxColumnCount',
    labelKey: _('Maximum Number of Columns'),
    keywords: ['column', 'columns', 'max', 'count', 'multi'],
    section: 'Page',
  },
  {
    id: 'settings.layout.maxInlineSize',
    labelKey: _('Maximum Column Width'),
    keywords: ['width', 'max', 'inline', 'size', 'column'],
    section: 'Page',
  },
  {
    id: 'settings.layout.maxBlockSize',
    labelKey: _('Maximum Column Height'),
    keywords: ['height', 'max', 'block', 'size'],
    section: 'Page',
  },
  {
    id: 'settings.layout.showHeader',
    labelKey: _('Show Header'),
    keywords: ['header', 'show', 'top', 'bar', 'title'],
    section: 'Header & Footer',
  },
  {
    id: 'settings.layout.showFooter',
    labelKey: _('Show Footer'),
    keywords: ['footer', 'show', 'bottom', 'bar', 'page', 'number'],
    section: 'Header & Footer',
  },
  {
    id: 'settings.layout.progressDisplay',
    labelKey: _('Reading Progress Style'),
    keywords: ['progress', 'display', 'page', 'number', 'percentage'],
    section: 'Header & Footer',
  },
];

// color panel items
const colorPanelItems = [
  {
    id: 'settings.color.themeMode',
    labelKey: _('Theme Mode'),
    keywords: ['theme', 'mode', 'dark', 'light', 'auto', 'system'],
    section: 'Theme',
  },
  {
    id: 'settings.color.invertImageInDarkMode',
    labelKey: _('Invert Image In Dark Mode'),
    keywords: ['invert', 'image', 'dark', 'mode', 'photo'],
    section: 'Theme',
  },
  {
    id: 'settings.color.overrideBookColor',
    labelKey: _('Override Book Color'),
    keywords: ['override', 'book', 'color', 'custom'],
    section: 'Theme',
  },
  {
    id: 'settings.color.themeColor',
    labelKey: _('Theme Color'),
    keywords: ['theme', 'color', 'palette', 'accent'],
    section: 'Theme',
  },
  {
    id: 'settings.color.backgroundTexture',
    labelKey: _('Background Image'),
    keywords: ['background', 'texture', 'image', 'paper', 'pattern'],
    section: 'Theme',
  },
  {
    id: 'settings.color.highlightColors',
    labelKey: _('Highlight Colors'),
    keywords: ['highlight', 'color', 'annotation', 'marker'],
    section: 'Highlight',
  },
  {
    id: 'settings.color.ttsHighlightStyle',
    labelKey: _('TTS Highlighting'),
    keywords: ['tts', 'highlight', 'style', 'speech', 'read', 'aloud'],
    section: 'Highlight',
  },
  {
    id: 'settings.color.readingRuler',
    labelKey: _('Reading Ruler'),
    keywords: ['reading', 'ruler', 'line', 'guide', 'focus'],
    section: 'Reading',
  },
  {
    id: 'settings.color.codeHighlighting',
    labelKey: _('Code Highlighting'),
    keywords: ['code', 'highlighting', 'syntax', 'programming'],
    section: 'Code',
  },
];

// control panel items
const controlPanelItems = [
  {
    id: 'settings.control.scrolledMode',
    labelKey: _('Scrolled Mode'),
    keywords: ['scroll', 'scrolled', 'mode', 'paginate', 'continuous'],
    section: 'Scroll',
  },
  {
    id: 'settings.control.continuousScroll',
    labelKey: _('Continuous Scroll'),
    keywords: ['continuous', 'scroll', 'endless', 'infinite'],
    section: 'Scroll',
  },
  {
    id: 'settings.control.overlapPixels',
    labelKey: _('Overlap Pixels'),
    keywords: ['overlap', 'pixels', 'scroll', 'offset'],
    section: 'Scroll',
  },
  {
    id: 'settings.control.clickToPaginate',
    labelKey: _('Click to Paginate'),
    keywords: ['click', 'tap', 'paginate', 'page', 'turn'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.clickBothSides',
    labelKey: _('Click Both Sides'),
    keywords: ['click', 'tap', 'both', 'sides', 'fullscreen'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.swapClickSides',
    labelKey: _('Swap Click Sides'),
    keywords: ['swap', 'click', 'tap', 'sides', 'reverse'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.disableDoubleClick',
    labelKey: _('Disable Double Click'),
    keywords: ['disable', 'double', 'click', 'tap'],
    section: 'Pagination',
  },
  {
    id: 'settings.control.enableQuickActions',
    labelKey: _('Enable Quick Actions'),
    keywords: ['quick', 'actions', 'annotation', 'enable'],
    section: 'Annotation Tools',
  },
  {
    id: 'settings.control.quickAction',
    labelKey: _('Quick Action'),
    keywords: ['quick', 'action', 'annotation', 'highlight', 'copy'],
    section: 'Annotation Tools',
  },
  {
    id: 'settings.control.copyToNotebook',
    labelKey: _('Copy to Notebook'),
    keywords: ['copy', 'notebook', 'annotation', 'excerpt'],
    section: 'Annotation Tools',
  },
  {
    id: 'settings.control.pagingAnimation',
    labelKey: _('Paging Animation'),
    keywords: ['paging', 'animation', 'transition', 'effect'],
    section: 'Animation',
  },
  {
    id: 'settings.control.einkMode',
    labelKey: _('E-Ink Mode'),
    keywords: ['eink', 'e-ink', 'kindle', 'e-reader', 'epaper'],
    section: 'Device',
  },
  {
    id: 'settings.control.colorEinkMode',
    labelKey: _('Color E-Ink Mode'),
    keywords: ['color', 'eink', 'e-ink', 'kaleido'],
    section: 'Device',
  },
  {
    id: 'settings.control.allowJavascript',
    labelKey: _('Allow JavaScript'),
    keywords: ['javascript', 'js', 'script', 'security', 'allow'],
    section: 'Security',
  },
];

// language panel items
const languagePanelItems = [
  {
    id: 'settings.language.interfaceLanguage',
    labelKey: _('Interface Language'),
    keywords: ['interface', 'language', 'locale', 'ui', 'translation'],
    section: 'Language',
  },
  {
    id: 'settings.language.translationEnabled',
    labelKey: _('Enable Translation'),
    keywords: ['translation', 'translate', 'enable', 'language'],
    section: 'Translation',
  },
  {
    id: 'settings.language.translationProvider',
    labelKey: _('Translation Service'),
    keywords: ['translation', 'provider', 'google', 'deepl', 'service'],
    section: 'Translation',
  },
  {
    id: 'settings.language.targetLanguage',
    labelKey: _('Translate To'),
    keywords: ['target', 'language', 'translation', 'destination'],
    section: 'Translation',
  },
  {
    id: 'settings.language.ttsTextTranslation',
    labelKey: _('TTS Text'),
    keywords: ['tts', 'text', 'translation', 'speech', 'read'],
    section: 'Translation',
  },
  {
    id: 'settings.language.quotationMarks',
    labelKey: _('Replace Quotation Marks'),
    keywords: ['quotation', 'marks', 'quotes', 'punctuation', 'cjk'],
    section: 'Punctuation',
  },
  {
    id: 'settings.language.chineseConversion',
    labelKey: _('Convert Simplified and Traditional Chinese'),
    keywords: ['chinese', 'conversion', 'simplified', 'traditional', 'cjk'],
    section: 'Chinese',
  },
];

// ai panel items
const aiPanelItems = [
  {
    id: 'settings.ai.enableAssistant',
    labelKey: _('Enable AI Assistant'),
    keywords: ['ai', 'assistant', 'enable', 'chatbot', 'llm'],
    section: 'AI',
  },
  {
    id: 'settings.ai.provider',
    labelKey: _('AI Provider'),
    keywords: ['ai', 'provider', 'ollama', 'gateway', 'service'],
    section: 'AI',
  },
  {
    id: 'settings.ai.ollamaUrl',
    labelKey: _('Ollama URL'),
    keywords: ['ollama', 'url', 'server', 'endpoint', 'api'],
    section: 'Ollama',
  },
  {
    id: 'settings.ai.ollamaModel',
    labelKey: _('Ollama Model'),
    keywords: ['ollama', 'model', 'llama', 'mistral', 'gemma'],
    section: 'Ollama',
  },
  {
    id: 'settings.ai.gatewayApiKey',
    labelKey: _('API Key'),
    keywords: ['api', 'key', 'gateway', 'token', 'secret'],
    section: 'AI Gateway',
  },
  {
    id: 'settings.ai.gatewayModel',
    labelKey: _('AI Gateway Model'),
    keywords: ['gateway', 'model', 'openai', 'gpt', 'claude'],
    section: 'AI Gateway',
  },
];

// custom panel items
const customPanelItems = [
  {
    id: 'settings.custom.contentCss',
    labelKey: _('Custom Content CSS'),
    keywords: ['custom', 'css', 'content', 'style', 'book'],
    section: 'Custom CSS',
  },
  {
    id: 'settings.custom.readerUiCss',
    labelKey: _('Custom Reader UI CSS'),
    keywords: ['custom', 'css', 'reader', 'ui', 'interface'],
    section: 'Custom CSS',
  },
];

const actionItems = [
  {
    id: 'action.toggleTheme',
    labelKey: _('Theme Mode'),
    keywords: ['theme', 'dark', 'light', 'auto', 'mode', 'toggle'],
  },
  {
    id: 'action.fullscreen',
    labelKey: _('Fullscreen'),
    keywords: ['fullscreen', 'full', 'screen', 'maximize', 'window'],
  },
  {
    id: 'action.alwaysOnTop',
    labelKey: _('Always on Top'),
    keywords: ['always', 'top', 'pin', 'window', 'float'],
  },
  {
    id: 'action.screenWakeLock',
    labelKey: _('Keep Screen Awake'),
    keywords: ['screen', 'wake', 'lock', 'awake', 'sleep', 'display'],
  },
  {
    id: 'action.autoUpload',
    labelKey: _('Auto Upload Books to Cloud'),
    keywords: ['auto', 'upload', 'cloud', 'sync', 'backup'],
  },
  {
    id: 'action.reload',
    labelKey: _('Reload Page'),
    keywords: ['reload', 'refresh', 'page'],
  },
  {
    id: 'action.openLastBooks',
    labelKey: _('Open Last Book on Start'),
    keywords: ['open', 'last', 'book', 'start', 'resume'],
  },
  {
    id: 'action.about',
    labelKey: _('About Readest'),
    keywords: ['about', 'readest', 'version', 'info'],
  },
  {
    id: 'action.telemetry',
    labelKey: _('Help improve Readest'),
    keywords: ['telemetry', 'analytics', 'improve', 'statistics'],
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
    panelLabel?: string,
  ): CommandItem => ({
    id: def.id,
    labelKey: def.labelKey,
    localizedLabel: _(def.labelKey),
    keywords: def.keywords,
    category: 'settings',
    panel,
    panelLabel: _(panelLabel ?? panel),
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
    items.push(createSettingsItem(def, 'Control', 'Behavior'));
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

  const createActionItem = (def: {
    id: string;
    action: () => void;
    icon?: IconType;
    isAvailable?: () => boolean;
  }): CommandItem => {
    const item = actionItems.find((item) => item.id === def.id);
    if (!item) throw new Error(`Action item definition not found for id: ${def.id}`);
    return {
      id: def.id,
      labelKey: item.labelKey,
      localizedLabel: _(item.labelKey),
      keywords: item.keywords,
      icon: def.icon ?? getThemeIcon(),
      category: 'actions',
      action: def.action,
      isAvailable: def.isAvailable,
    };
  };

  items.push(
    createActionItem({
      id: 'action.toggleTheme',
      action: options.toggleTheme,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.fullscreen',
      action: options.toggleFullscreen,
      isAvailable: () => isDesktop,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.alwaysOnTop',
      action: options.toggleAlwaysOnTop,
      isAvailable: () => isDesktop,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.screenWakeLock',
      action: options.toggleScreenWakeLock,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.autoUpload',
      action: options.toggleAutoUpload,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.reload',
      icon: MdRefresh,
      action: options.reloadPage,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.openLastBooks',
      action: options.toggleOpenLastBooks,
      isAvailable: () => isDesktop,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.about',
      action: options.showAbout,
    }),
  );

  items.push(
    createActionItem({
      id: 'action.telemetry',
      action: options.toggleTelemetry,
    }),
  );

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
