import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  APPEARANCE_STORAGE_KEY,
  parseAppearanceMode,
  resolveAppearance,
  type AppearanceMode,
  type ResolvedAppearance,
} from '@service-center/shared';

export type ThemeMode = AppearanceMode;

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedAppearance;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const resolveTheme = (mode: ThemeMode): ResolvedAppearance =>
  resolveAppearance(mode, window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => parseAppearanceMode(localStorage.getItem(APPEARANCE_STORAGE_KEY)));
  const [resolved, setResolved] = useState<ResolvedAppearance>(() => resolveTheme(mode));

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const next = resolveTheme(mode);
      setResolved(next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.documentElement.style.colorScheme = next;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);

  const value = useMemo(() => ({
    mode,
    resolved,
    setMode: (next: ThemeMode) => {
      setModeState(next);
      if (next === 'system') localStorage.removeItem(APPEARANCE_STORAGE_KEY);
      else localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
    },
  }), [mode, resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
};
