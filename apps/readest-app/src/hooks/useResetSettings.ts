import { useEnv } from '@/context/EnvContext';
import { ViewSettings } from '@/types/book';

type SetterKey = keyof ViewSettings;

type StateSetters = Partial<{
  [Key in SetterKey]: (value: NonNullable<ViewSettings[Key]>) => void;
}>;

export const useResetViewSettings = () => {
  const { appService } = useEnv();

  const resetToDefaults = (setters: StateSetters) => {
    if (!appService) return;
    const defaultSettings = appService.getDefaultViewSettings();

    (Object.keys(setters) as SetterKey[]).forEach(<Key extends SetterKey>(settingKey: Key) => {
      const freshValue = defaultSettings[settingKey];
      if (freshValue !== undefined) {
        setters[settingKey]?.(freshValue);
      }
    });
  };

  return resetToDefaults;
};
