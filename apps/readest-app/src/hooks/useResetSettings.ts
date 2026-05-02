import { useEnv } from '@/context/EnvContext';
import { ViewSettings } from '@/types/book';

type SetterKey = keyof ViewSettings;

type StateSetters = Partial<{
  [Key in SetterKey]: (value: ViewSettings[Key]) => void;
}>;

export const useResetViewSettings = () => {
  const { appService } = useEnv();

  const resetToDefaults = (setters: StateSetters) => {
    if (!appService) return;
    const defaultSettings = appService.getDefaultViewSettings();

    Object.entries(setters).forEach(([settingKey, setter]) => {
      const freshValue = defaultSettings[settingKey as SetterKey];
      if (freshValue !== undefined) {
        setter(freshValue as never);
      }
    });
  };

  return resetToDefaults;
};
