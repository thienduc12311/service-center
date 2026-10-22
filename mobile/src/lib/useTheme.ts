import { useMemo } from 'react';
import { useAppearance } from '../providers/AppearanceProvider';
import { themes, type Theme } from './theme';

/** The palette, spacing and type scale for the scheme currently in effect. */
export const useTheme = (): Theme => themes[useAppearance().resolved];

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
