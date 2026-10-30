import { getTranslator } from '@/services/translators';
import { detectLanguage } from '@/utils/lang';
import { getLocale } from '@/utils/misc';

export async function translateSingleText(
  text: string,
  sourceLang = 'AUTO',
  targetLang?: string,
): Promise<{ translated: string; source: string; target: string }> {
  const clean = text.trim();
  if (!clean) return { translated: '', source: sourceLang, target: targetLang || 'en' };

  const finalTarget = targetLang || getLocale().split('-')[0] || 'en';
  const detectedSource = sourceLang === 'AUTO' ? detectLanguage(clean) : sourceLang;

  // Try google translator by default as it doesn't require auth token
  const provider =
    getTranslator('google') ||
    getTranslator('yandex') ||
    getTranslator('azure') ||
    getTranslator('deepl');
  if (!provider) {
    throw new Error('No translation provider available');
  }

  const results = await provider.translate([clean], detectedSource, finalTarget);
  return {
    translated: results[0] || clean,
    source: detectedSource,
    target: finalTarget,
  };
}
