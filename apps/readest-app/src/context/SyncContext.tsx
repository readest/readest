'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { SyncClient } from '@/libs/sync';

const syncClient = new SyncClient();

interface SyncContextType {
  syncClient: SyncClient;
}

const SyncContext = createContext<SyncContextType>({ syncClient });

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useMemo(() => ({ syncClient }), []);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export const useSyncContext = () => useContext(SyncContext);
