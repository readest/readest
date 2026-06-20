import { create } from 'zustand';

export type AppLockDialogMode = 'set' | 'change' | 'disable';

interface AppLockState {
  /**
   * Has the gate been initialized from on-disk settings yet? Until
   * this flips to `true` the gate renders nothing — guarantees the
   * library/reader can never flash on screen before the lock screen
   * does.
   */
  isInitialized: boolean;

  /**
   * Session-scoped unlock flag. `true` if there is no PIN configured
   * OR the user has entered the correct PIN since this page load.
   * Flipping back to `false` is reserved for future re-lock-on-resume
   * work; today nothing calls `lock()` after the initial unlock.
   */
  isUnlocked: boolean;

  /** Cached copy of the PIN salt + hash — mirrors `SystemSettings`. */
  pinHash: string | null;
  pinSalt: string | null;

  /**
   * Startup snapshot of `SystemSettings.biometricUnlockEnabled` (mobile-only).
   * Threaded through `initialize` so `AppLockScreen` never races the page-level
   * settingsStore seed.
   */
  biometricUnlockEnabled: boolean;

  /** Called once from `Providers` after `loadSettings` resolves. */
  initialize: (config: {
    enabled: boolean;
    hash?: string;
    salt?: string;
    biometricUnlockEnabled?: boolean;
  }) => void;

  /** Called by `<AppLockScreen />` after a verified PIN entry. */
  unlock: () => void;

  /** Reserved for future re-lock work (background timeout, etc.). */
  lock: () => void;

  /** Called from the settings dialog after persisting a new/changed PIN. */
  setPin: (hash: string, salt: string) => void;

  /** Called from the settings dialog after disabling the lock. */
  clearPin: () => void;

  /**
   * Which app-lock dialog (if any) is currently open. Lifted out of
   * `SettingsMenu` because that component unmounts when its dropdown
   * closes — local dialog state would never get to render.
   */
  dialogMode: AppLockDialogMode | null;
  openDialog: (mode: AppLockDialogMode) => void;
  closeDialog: () => void;
}

export const useAppLockStore = create<AppLockState>((set) => ({
  isInitialized: false,
  isUnlocked: true,
  pinHash: null,
  pinSalt: null,
  biometricUnlockEnabled: false,
  initialize: ({ enabled, hash, salt, biometricUnlockEnabled }) =>
    set({
      isInitialized: true,
      isUnlocked: !enabled,
      pinHash: hash ?? null,
      pinSalt: salt ?? null,
      biometricUnlockEnabled: !!biometricUnlockEnabled,
    }),
  unlock: () => set({ isUnlocked: true }),
  lock: () => set({ isUnlocked: false }),
  setPin: (hash, salt) => set({ pinHash: hash, pinSalt: salt }),
  clearPin: () => set({ pinHash: null, pinSalt: null, isUnlocked: true }),
  dialogMode: null,
  openDialog: (mode) => set({ dialogMode: mode }),
  closeDialog: () => set({ dialogMode: null }),
}));
