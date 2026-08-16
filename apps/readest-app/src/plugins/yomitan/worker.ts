import {
  startPluginWorkerServer,
  type PluginWorkerGlobalLike,
} from '@/services/plugins/workerServer';
import { yomitanOperationHandlers } from './handlers';

const workerScope: PluginWorkerGlobalLike = self as unknown as DedicatedWorkerGlobalScope;

startPluginWorkerServer(workerScope, yomitanOperationHandlers);
