'use client';

import React, { createContext, useContext } from 'react';
import { SyncClient } from '@/libs/sync';

const syncClient = new SyncClient();

interface SyncContextType {
  syncClient: SyncClient;
}

const SyncContext = createContext<SyncContextType>({ syncClient });

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <SyncContext.Provider value={{ syncClient }}>{children}</SyncContext.Provider>;
};

export const useSyncContext = () => useContext(SyncContext);
