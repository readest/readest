import { generateText } from 'ai';
import { getAIProvider } from '@/services/ai/providers';
import { useSettingsStore } from '@/store/settingsStore';
import { getLanguageName } from '@/utils/lang';
import { stubTranslation as _ } from '@/utils/misc';
import { TranslationProvider } from '../types';

export const aiAssistantProvider: TranslationProvider = {
  name: 'ai-assistant',
  label: _('AI Assistant (CPA)'),
  translate: async (texts: string[], sourceLang: string, targetLang: string): Promise<string[]> => {
    const settings = useSettingsStore.getState().settings?.aiSettings;
    if (!settings?.enabled) {
      throw new Error('Enable and configure AI Assistant before using AI translation');
    }

    const provider = getAIProvider(settings);
    const source =
      sourceLang === 'AUTO' ? 'the detected source language' : getLanguageName(sourceLang);
    const target = getLanguageName(targetLang);

    return Promise.all(
      texts.map(async (text) => {
        if (!text?.trim()) return text;
        const result = await generateText({
          model: provider.getModel(),
          system:
            'You are a precise literary translator. Return only the translated text. ' +
            'Do not add explanations, notes, quotation marks, headings, or Markdown.',
          prompt:
            'Translate the following text from ' +
            source +
            ' to ' +
            target +
            '. Preserve paragraphs, formatting, names, numbers, and punctuation.\n\n' +
            text,
          temperature: 0.2,
        });
        return result.text.trim() || text;
      }),
    );
  },
};
