/**
 * Re-export shim: the activation helpers moved to the services layer
 * (`src/services/sync/cloudSyncActivation.ts`) so service modules never
 * import from components. Existing component-side imports keep working.
 */
export {
  withActiveCloudProvider,
  persistActiveCloudProvider,
  persistCloudProviderEnabled,
  type CloudSyncActivationKind,
} from '@/services/sync/cloudSyncActivation';
