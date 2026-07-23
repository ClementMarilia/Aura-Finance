import {
  APP_VERSION,
  applySWUpdate,
  checkForSWUpdate,
  getSWUpdateState,
  subscribeToSWUpdates,
} from "@/sw-register";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const PWAUpdateContext = createContext(null);

export function PWAUpdateProvider({ children }) {
  const [updateState, setUpdateState] = useState(getSWUpdateState);

  useEffect(() => subscribeToSWUpdates(setUpdateState), []);

  const value = useMemo(
    () => ({
      ...updateState,
      appVersion: APP_VERSION,
      checkForUpdate: checkForSWUpdate,
      applyUpdate: applySWUpdate,
    }),
    [updateState],
  );

  return (
    <PWAUpdateContext.Provider value={value}>
      {children}
    </PWAUpdateContext.Provider>
  );
}

export function usePWAUpdate() {
  const context = useContext(PWAUpdateContext);
  if (!context) {
    throw new Error("usePWAUpdate deve ser usado dentro de PWAUpdateProvider");
  }
  return context;
}
