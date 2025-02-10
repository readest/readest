// default open-next.config.ts file created by @opennextjs/cloudflare

import cache from '@opennextjs/cloudflare/kv-cache';

const config: {
  debug?: boolean;
  getAssetUrl?: () => string;
  getBuildId?: () => string;
  getKVKey?: () => string;
  default?: {
    override: {
      wrapper: string;
      converter: string;
      incrementalCache: () => Promise<unknown>;
      tagCache: string;
      queue: string;
    };
  };
  middleware?: {
    external: boolean;
    override: {
      wrapper: string;
      converter: string;
      proxyExternalRequest: string;
    };
  };
  dangerous?: {
    enableCacheInterception: boolean;
  };
} = {
  default: {
    override: {
      wrapper: 'cloudflare-node',
      converter: 'edge',
      incrementalCache: async () => cache,
      tagCache: 'dummy',
      queue: 'dummy',
    },
  },

  middleware: {
    external: true,
    override: {
      wrapper: 'cloudflare-edge',
      converter: 'edge',
      proxyExternalRequest: 'fetch',
    },
  },

  dangerous: {
    enableCacheInterception: false,
  },
};

export default config;
