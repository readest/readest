import { SourceBroker, SqlBroker } from '@/services/plugins/brokers';
import type { BundledPluginDefinition } from '@/services/plugins/catalog';
import { createPluginHostCallHandler } from '@/services/plugins/hostCalls';
import { createPluginRuntime } from '@/services/plugins/runtime';

interface LookupRuntimeEntry {
  runtime: ReturnType<typeof createPluginRuntime>;
  sourceBroker: SourceBroker;
  sqlBroker: SqlBroker;
  references: number;
}

export interface PluginLookupRuntimeLease
  extends Pick<LookupRuntimeEntry, 'runtime' | 'sourceBroker' | 'sqlBroker'> {
  release(): void;
}

let pools = new WeakMap<object, Map<string, LookupRuntimeEntry>>();

export const acquirePluginLookupRuntime = (
  host: object,
  plugin: BundledPluginDefinition,
): PluginLookupRuntimeLease => {
  let hostPool = pools.get(host);
  if (!hostPool) {
    hostPool = new Map();
    pools.set(host, hostPool);
  }
  const pluginId = plugin.manifest.id;
  let entry = hostPool.get(pluginId);
  if (!entry) {
    const sourceBroker = new SourceBroker();
    const sqlBroker = new SqlBroker();
    entry = {
      sourceBroker,
      sqlBroker,
      runtime: createPluginRuntime({
        createWorker: () => plugin.createWorker('lookup'),
        handleHostCall: createPluginHostCallHandler(pluginId, sourceBroker, sqlBroker),
      }),
      references: 0,
    };
    hostPool.set(pluginId, entry);
  }
  entry.references += 1;
  let released = false;
  return {
    runtime: entry.runtime,
    sourceBroker: entry.sourceBroker,
    sqlBroker: entry.sqlBroker,
    release: () => {
      if (released) return;
      released = true;
      entry!.references -= 1;
      if (entry!.references > 0) return;
      entry!.runtime.close();
      hostPool!.delete(pluginId);
    },
  };
};

export const __resetPluginLookupRuntimesForTests = (): void => {
  pools = new WeakMap();
};
