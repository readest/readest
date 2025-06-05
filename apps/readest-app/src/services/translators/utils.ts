const DAILY_USAGE_KEY = 'translationDailyUsage';

export const saveDailyUsage = (usage: number, date?: string) => {
  if (typeof window !== 'undefined') {
    const isoDate = date || new Date().toISOString().split('T')[0]!;
    const dailyUsage = { [isoDate]: usage };
    localStorage.setItem(DAILY_USAGE_KEY, JSON.stringify(dailyUsage));
  }
};

export const getDailyUsage = (date?: string): number | null => {
  if (typeof window !== 'undefined') {
    const isoDate = date || new Date().toISOString().split('T')[0]!;
    const usage = localStorage.getItem(DAILY_USAGE_KEY);
    if (usage) {
      const dailyUsage = JSON.parse(usage);
      if (dailyUsage[isoDate]) {
        return dailyUsage[isoDate];
      }
    }
  }
  return null;
};
