import { Dispatch, SetStateAction } from 'react';
import { useEnv } from '@/context/EnvContext';
import { ViewSettings } from '@/types/book';

type SetterKey = keyof ViewSettings;
type SetterValue = SetStateAction<string> & SetStateAction<number> & SetStateAction<boolean>;

type StateSetters = Partial<{
  [Key in SetterKey]: Dispatch<SetterValue>;
}>;

export const useResetViewSettings = () => {
  const { appService } = useEnv();

  const resetToDefaults = (setters: StateSetters) => {
    if (!appService) return;
    const defaultSettings = appService.getDefaultViewSettings();

    Object.entries(setters).forEach(([settingKey, setter]) => {
      const freshValue = defaultSettings[settingKey as SetterKey];
      if (freshValue !== undefined) {
        setter(freshValue as SetterValue);
      }
    });
  };

  return resetToDefaults;
};
