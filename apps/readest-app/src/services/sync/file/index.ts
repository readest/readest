/**
 * Provider-agnostic file-sync core. Consumers import the engine, the provider
 * interface, and the local-store bridge from here; a concrete backend lives
 * under `src/services/sync/providers/<name>/`.
 */
export * from './provider';
export * from './localStore';
export * from './layout';
export * from './wire';
export * from './merge';
export * from './engine';
