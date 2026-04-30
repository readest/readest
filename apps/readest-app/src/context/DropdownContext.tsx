// DropdownContext.tsx
import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface DropdownContextValue {
  openDropdownId: string | null;
  openDropdown: (id: string) => void;
  closeDropdown: (id: string) => void;
  closeAll: () => void;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

export const DropdownProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const openDropdown = useCallback((id: string) => {
    setOpenDropdownId(id);
  }, []);

  const closeDropdown = useCallback((id: string) => {
    setOpenDropdownId((current) => (current === id ? null : current));
  }, []);

  const closeAll = useCallback(() => {
    setOpenDropdownId(null);
  }, []);

  const value = useMemo(
    () => ({ openDropdownId, openDropdown, closeDropdown, closeAll }),
    [openDropdownId, openDropdown, closeDropdown, closeAll],
  );
  return <DropdownContext.Provider value={value}>{children}</DropdownContext.Provider>;
};

export const useDropdownContext = () => useContext(DropdownContext);
