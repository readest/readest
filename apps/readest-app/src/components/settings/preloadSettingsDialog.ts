/**
 * Settings loads when it first opens (~1.5 MB of code, ~1 s on an e-ink reader). The menus that
 * open it start the load as they open, two frames on: Readest Lite loads a script on the main
 * thread, and a load started with the menu held the menu's own frame back.
 */
export const preloadSettingsDialog = () => {
  requestAnimationFrame(() => requestAnimationFrame(() => void import('./SettingsDialog')));
};
