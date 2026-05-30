/**
 * Settings panel primitives — the canonical building blocks for boxed-list
 * settings UIs across all panels (Font, Layout, Color, Integrations, etc.).
 * See DESIGN.md §5 for the rules each primitive embodies.
 *
 * Use these instead of inlining the chassis classnames; the moment a
 * design rule changes, all callers update for free.
 */
export { default as BoxedList } from './BoxedList';
export { default as SettingsRow } from './SettingsRow';
export { default as SettingsSwitchRow } from './SettingsSwitchRow';
export { default as SettingsSelect } from './SettingsSelect';
export { default as SettingsInput } from './SettingsInput';
export { default as NavigationRow } from './NavigationRow';
export { default as SectionTitle } from './SectionTitle';
export { default as SettingLabel } from './SettingLabel';
export { default as Tips } from './Tips';
