/**
 * MOB-021: the facts the About and help screen shows. Pure, so the screen
 * never invents a version, build or address it cannot read.
 */

export type BuildKind = 'expo-go' | 'installed';

export interface AboutSource {
  version: string | null | undefined;
  executionEnvironment: string | null | undefined;
  apiUrl: string;
  webAppDomain: string;
}

export interface AboutDetails {
  /** `null` when the build carries no version. */
  version: string | null;
  build: BuildKind;
  /** Host (and port) of the API, never credentials or a path. */
  server: string | null;
  /** The website, only when this build names a real domain. */
  websiteUrl: string | null;
}

const serverHost = (apiUrl: string): string | null => {
  try {
    return new URL(apiUrl).host || null;
  } catch {
    return null;
  }
};

export const aboutDetails = (source: AboutSource): AboutDetails => ({
  version: source.version?.trim() || null,
  // expo-constants reports 'storeClient' inside Expo Go; 'standalone'/'bare' are real builds.
  build: source.executionEnvironment === 'storeClient' ? 'expo-go' : 'installed',
  server: serverHost(source.apiUrl),
  websiteUrl: source.webAppDomain ? `https://${source.webAppDomain}` : null,
});
