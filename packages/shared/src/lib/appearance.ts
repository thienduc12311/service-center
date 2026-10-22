/**
 * Light/dark/system appearance, kept the same on the website and the phone.
 * The choice is a device setting (no server copy, like the website's
 * localStorage entry): it is not account data, so it survives sign-out and
 * never travels between devices. "System" follows the operating system.
 */

export type AppearanceMode = 'light' | 'dark' | 'system';
export type ResolvedAppearance = 'light' | 'dark';

export const APPEARANCE_MODES: readonly AppearanceMode[] = ['light', 'dark', 'system'];

/** The website's localStorage key; native uses the same name in AsyncStorage. */
export const APPEARANCE_STORAGE_KEY = 'service-center-theme';

/** A missing or unknown stored value means "system", the default on both clients. */
export const parseAppearanceMode = (stored: string | null | undefined): AppearanceMode =>
  stored === 'light' || stored === 'dark' ? stored : 'system';

/** The scheme actually drawn; an unknown OS scheme draws light. */
export const resolveAppearance = (
  mode: AppearanceMode,
  system: string | null | undefined,
): ResolvedAppearance => {
  if (mode !== 'system') return mode;
  return system === 'dark' ? 'dark' : 'light';
};
