import type { PluginHostCall, PluginRequest } from './contract';
import { SourceBroker, SqlBroker, type PluginScope } from './brokers';
import type { PluginHostCallHandler } from './runtime';

const scopeForRequest = (pluginId: string, request: PluginRequest): PluginScope => {
  const payload = request.payload;
  const dictionaryId = 'dictionaryId' in payload ? payload.dictionaryId : undefined;
  return { pluginId, ...(dictionaryId === undefined ? {} : { dictionaryId }) };
};

export const createPluginHostCallHandler =
  (pluginId: string, sourceBroker: SourceBroker, sqlBroker: SqlBroker): PluginHostCallHandler =>
  async (call: PluginHostCall, request: PluginRequest): Promise<unknown> => {
    const scope = scopeForRequest(pluginId, request);
    switch (call.capability) {
      case 'source.stat':
        return sourceBroker.stat(scope, call.payload);
      case 'source.readRange':
        return sourceBroker.readRange(scope, call.payload);
      case 'sql.execute':
        return sqlBroker.execute(scope, call.payload);
      case 'sql.select':
        return sqlBroker.select(scope, call.payload);
      case 'sql.transaction':
        return sqlBroker.transaction(scope, call.payload);
    }
  };
