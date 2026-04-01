import { create } from 'zustand';

type SpinDirection = 'cw' | 'ccw' | null;

const getInitialActive = (): boolean => {
  return false;
};

interface AtmosphereState {
  active: boolean;
  spinDirection: SpinDirection;
  shaking: boolean;
  activate: () => void;
  deactivate: () => void;
  toggle: () => void;
  toggleWithShake: () => void;
}

export const useAtmosphereStore = create<AtmosphereState>((set, get) => ({
  active: getInitialActive(),
  spinDirection: null,
  shaking: false,
  activate: () => {
    localStorage.setItem('atmosphereActive', 'true');
    set({ active: true });
  },
  deactivate: () => {
    localStorage.setItem('atmosphereActive', 'false');
    set({ active: false, shaking: false });
  },
  toggle: () => {
    const wasActive = get().active;
    localStorage.setItem('atmosphereActive', String(!wasActive));
    set({ spinDirection: wasActive ? 'ccw' : 'cw', active: !wasActive });
    setTimeout(() => set({ spinDirection: null }), 600);
  },
  toggleWithShake: () => {
    const wasActive = get().active;
    localStorage.setItem('atmosphereActive', String(!wasActive));
    set({ shaking: true, active: !wasActive });
    setTimeout(() => set({ shaking: false }), 500);
  },
}));
