export class TTSUtils {
  private static readonly LOCAL_STORAGE_KEY = 'ttsPreferredVoices';
  private static readonly PREFERRED_CLIENT_KEY = 'preferredClient';

  private static normalizeLanguage(language: string): string {
    if (!language) return 'n/a';
    return language.toLowerCase().slice(0, 2);
  }

  static setPreferredClient(engine: string): void {
    if (!engine) return;
    const preferences = this.getPreferences();
    preferences[this.PREFERRED_CLIENT_KEY] = engine;
    localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(preferences));
  }

  static setPreferredVoice(engine: string, language: string, voiceId: string): void {
    if (!engine || !language || !voiceId) return;
    const preferences = this.getPreferences();
    const lang = this.normalizeLanguage(language);
    preferences[`${engine}-${lang}`] = voiceId;
    localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(preferences));
  }

  static getPreferredClient(): string | null {
    const preferences = this.getPreferences();
    return preferences[this.PREFERRED_CLIENT_KEY] || null;
  }

  static getPreferredVoice(engine: string, language: string): string | null {
    const preferences = this.getPreferences();
    const lang = this.normalizeLanguage(language);
    return preferences[`${engine}-${lang}`] || null;
  }

  private static getPreferences(): Record<string, string> {
    const storedPreferences = localStorage.getItem(this.LOCAL_STORAGE_KEY);
    return storedPreferences ? JSON.parse(storedPreferences) : {};
  }
}
