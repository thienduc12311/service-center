import { useMemo } from 'react';
import { useColorScheme } from 'nativewind';
import { themes, type ColorSchemeName, type Theme } from './theme';

/** The palette, spacing and type scale for the scheme currently in effect. */
export const useTheme = (): Theme => {
  const { colorScheme } = useColorScheme();
  return themes[colorScheme === 'dark' ? 'dark' : 'light'];
};

export interface ColorSchemeControl {
  scheme: ColorSchemeName;
  setScheme: (scheme: ColorSchemeName) => void;
}

/** Read/write access to the scheme, for the appearance switch on Profile. */
export const useColorSchemeControl = (): ColorSchemeControl => {
  const { colorScheme, setColorScheme } = useColorScheme();
  return {
    scheme: colorScheme === 'dark' ? 'dark' : 'light',
    setScheme: setColorScheme,
  };
};

/**
 * Builds a screen's stylesheet from the active theme, rebuilding it only when
 * the scheme actually flips.
 *
 *   const styles = useThemedStyles(makeStyles);
 *   const makeStyles = (t: Theme) => StyleSheet.create({ ... });
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}
