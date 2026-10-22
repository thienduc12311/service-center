import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { resolveAppearance, type AppearanceMode, type ResolvedAppearance } from '@service-center/shared';
import { loadAppearanceMode, storeAppearanceMode } from '../lib/appearance-storage';

export interface AppearanceContextValue {
  mode: AppearanceMode;
  /** The scheme drawn now: the choice, or the OS scheme in system mode. */
  resolved: ResolvedAppearance;
  /** True when the last choice applies but could not be written to the device. */
  saveFailed: boolean;
  setMode: (mode: AppearanceMode) => void;
}

/** A storage read slower than this draws the system scheme rather than holding the splash. */
const RESTORE_TIMEOUT_MS = 1500;

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/**
 * The OS override keeps native pieces (alerts, pickers, keyboard) in the same
 * scheme as the app; "unspecified" hands control back to the OS, after which
 * `useColorScheme` reports the OS scheme and follows its changes.
 */
const applyToOs = (mode: AppearanceMode): void => {
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
};

/**
 * MOB-021: restores the saved appearance before the app draws, so a restart
 * keeps the choice without a flash of the other scheme.
 */
export const AppearanceProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<AppearanceMode | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const system = useColorScheme();

  useEffect(() => {
    let active = true;
    const timeout = new Promise<AppearanceMode>((_, reject) => {
      setTimeout(() => reject(new Error('timed out')), RESTORE_TIMEOUT_MS);
    });
    Promise.race([loadAppearanceMode(), timeout])
      .catch((error: unknown) => {
        console.warn('[appearance] could not read the saved choice; following the system', error);
        return 'system' as const;
      })
      .then((stored) => {
        if (!active) return;
        applyToOs(stored);
        setModeState(stored);
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: AppearanceMode): void => {
    applyToOs(next);
    setModeState(next);
    setSaveFailed(false);
    storeAppearanceMode(next).catch((error: unknown) => {
      console.warn('[appearance] could not save the choice', error);
      setSaveFailed(true);
    });
  }, []);

  const value = useMemo<AppearanceContextValue | null>(
    () => (mode ? { mode, resolved: resolveAppearance(mode, system), saveFailed, setMode } : null),
    [mode, system, saveFailed, setMode],
  );

  if (!value) return null;
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
};

export const useAppearance = (): AppearanceContextValue => {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used inside AppearanceProvider');
  return value;
};
