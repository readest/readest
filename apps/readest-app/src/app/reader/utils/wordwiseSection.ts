import type { ViewSettings } from '@/types/book';
import type { AppService } from '@/types/system';
import type { ProgressHandler } from '@/utils/transfer';
import { canTokenizeSource, getRankCutoff } from '@/services/wordwise/difficulty';
import { loadGlossIndex } from '@/services/wordwise/glossPacks';
import { planGlosses } from '@/services/wordwise/planner';
import { buildSectionTextModel, applyGlosses, clearGlosses } from '@/app/reader/utils/wordwiseRuby';
import { cutZh, isJiebaReady, initJieba } from '@/utils/jieba';

/** Normalize a book language tag to its 2-letter base source code, or null. */
export const toWordWiseSource = (lang?: string | null): string | null => {
  if (!lang) return null;
  const base = lang.toLowerCase().split('-')[0];
  return base || null;
};

interface RefreshContext {
  appService: AppService;
  bookLang?: string | null;
  /** App UI language base code, used as the hint when none is selected. */
  appLang: string;
  /**
   * Whether the reader may silently download an uncached pack. Threaded to
   * loadGlossIndex → ensurePack; when false an uncached pack yields no glosses
   * (the user downloads it explicitly from the Word Wise sub-page).
   */
  allowDownload?: boolean;
  onProgress?: ProgressHandler;
}

// Per-document generation counter. Dragging the difficulty slider fires the
// settings effect repeatedly, producing overlapping refresh calls. A later call
// supersedes earlier ones: each call stamps its generation, and any call whose
// stamp is stale after the `await` bails before touching the DOM, so the latest
// refresh always builds and applies against a clean, un-glossed document.
const refreshGen = new WeakMap<Document, number>();

/** Re-render glosses for one section doc. Clears first, then injects if enabled. */
export const refreshSectionGlosses = async (
  doc: Document,
  viewSettings: ViewSettings,
  ctx: RefreshContext,
): Promise<void> => {
  // This runs fire-and-forget (`void refreshSectionGlosses(...)`), and its
  // post-await synchronous DOM work (buildSectionTextModel / planGlosses /
  // applyGlosses → range.insertNode) can throw. Contain everything so a failure
  // never escapes as an unhandledrejection.
  try {
    const myGen = (refreshGen.get(doc) ?? 0) + 1;
    refreshGen.set(doc, myGen);
    clearGlosses(doc);
    if (!viewSettings.wordWiseEnabled) return;
    const source = toWordWiseSource(ctx.bookLang);
    if (!source || !canTokenizeSource(source)) return;
    const hint = (viewSettings.wordWiseHintLang || ctx.appLang).toLowerCase().split('-')[0] || '';
    if (!hint || hint === source) return; // no self-gloss
    const index = await loadGlossIndex(ctx.appService, source, hint, {
      onProgress: ctx.onProgress,
      allowDownload: ctx.allowDownload,
    });
    if (refreshGen.get(doc) !== myGen) return; // a newer refresh superseded us
    if (!index) return;
    if (source === 'zh' && !isJiebaReady()) {
      void initJieba();
      return;
    }
    const model = buildSectionTextModel(doc);
    const occ = planGlosses(model.text, index, {
      sourceLang: source,
      rankCutoff: getRankCutoff(source, viewSettings.wordWiseLevel),
      cutZh: source === 'zh' ? cutZh : undefined,
    });
    if (occ.length) applyGlosses(doc, model, occ);
  } catch (err) {
    console.warn('[wordwise] refresh failed', err);
  }
};
