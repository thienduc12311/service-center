import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_STORAGE_KEY } from '@service-center/shared';
import { aboutDetails } from './about';

const stored = new Map<string, string>();
let failWrites = false;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (failWrites) throw new Error('disk full');
      stored.set(key, value);
    },
    removeItem: async (key: string) => {
      if (failWrites) throw new Error('disk full');
      stored.delete(key);
    },
  },
}));

const { loadAppearanceMode, storeAppearanceMode } = await import('./appearance-storage');

describe('MOB-021 appearance on the device', () => {
  beforeEach(() => {
    stored.clear();
    failWrites = false;
  });

  it('starts in system mode, like the website', async () => {
    expect(await loadAppearanceMode()).toBe('system');
  });

  it('reads back light and dark after a restart, under the website key and value', async () => {
    await storeAppearanceMode('dark');
    expect(stored.get(APPEARANCE_STORAGE_KEY)).toBe('dark');
    expect(await loadAppearanceMode()).toBe('dark');
    await storeAppearanceMode('light');
    expect(await loadAppearanceMode()).toBe('light');
  });

  it('stores system as no entry, as the website does', async () => {
    await storeAppearanceMode('dark');
    await storeAppearanceMode('system');
    expect(stored.has(APPEARANCE_STORAGE_KEY)).toBe(false);
    expect(await loadAppearanceMode()).toBe('system');
  });

  it('treats a corrupt entry as system', async () => {
    stored.set(APPEARANCE_STORAGE_KEY, '{"mode":"dark"}');
    expect(await loadAppearanceMode()).toBe('system');
  });

  it('reports a failed save instead of pretending it was kept', async () => {
    failWrites = true;
    await expect(storeAppearanceMode('dark')).rejects.toThrow();
    expect(await loadAppearanceMode()).toBe('system');
  });
});

describe('MOB-021 about details', () => {
  const source = { version: '0.1.0', executionEnvironment: 'standalone', apiUrl: 'https://api.example.org/base', webAppDomain: 'app.example.org' };

  it('shows the build version, kind, API host and website', () => {
    expect(aboutDetails(source)).toEqual({
      version: '0.1.0',
      build: 'installed',
      server: 'api.example.org',
      websiteUrl: 'https://app.example.org',
    });
  });

  it('says Expo Go when running there', () => {
    expect(aboutDetails({ ...source, executionEnvironment: 'storeClient' }).build).toBe('expo-go');
  });

  it('never invents a version, server or website it cannot read', () => {
    expect(aboutDetails({ ...source, version: ' ', apiUrl: 'not a url', webAppDomain: '' })).toEqual({
      version: null,
      build: 'installed',
      server: null,
      websiteUrl: null,
    });
    expect(aboutDetails({ ...source, version: undefined }).version).toBeNull();
  });

  it('shows only the host, never credentials in the API address', () => {
    expect(aboutDetails({ ...source, apiUrl: 'http://user:secret@localhost:4000/x' }).server).toBe('localhost:4000');
  });
});

describe('MOB-021 settings (source contract)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const provider = read('src', 'providers', 'AppearanceProvider.tsx');
  const layout = read('app', '_layout.tsx');
  const profile = read('app', '(tabs)', 'profile.tsx');
  const about = read('app', 'about.tsx');
  const selector = read('src', 'components', 'AppearanceSelector.tsx');

  it('hands system mode back to the OS and follows its changes', () => {
    expect(provider).toContain("mode === 'system' ? 'unspecified' : mode");
    expect(provider).toContain('useColorScheme()');
    expect(provider).toContain('resolveAppearance(mode, system)');
  });

  it('restores the choice before drawing and colours the status bar from the app scheme', () => {
    expect(layout.indexOf('<AppearanceProvider>')).toBeLessThan(layout.indexOf('<QueryClientProvider'));
    expect(layout).toContain("style={resolved === 'dark' ? 'light' : 'dark'}");
    expect(layout).not.toContain('style="auto"');
  });

  it('offers all three website modes with the website labels', () => {
    expect(selector).toContain('APPEARANCE_MODES.map');
    expect(selector).toContain('profile.appearance.${option}');
    expect(profile).toContain('<AppearanceSelector />');
  });

  it('uses the website profile and language methods and labels', () => {
    expect(profile).toContain('api.updateMe({ full_name: fullName, phone: phone || null })');
    expect(profile).toContain("t('settingsPage.profile.title')");
    expect(profile).toContain("t('settingsPage.profile.save')");
    expect(profile).toContain('<LanguageSelector');
  });

  it('asks before signing out and explains what is cleared', () => {
    expect(profile).toContain("t('about.signOutMessage'");
    expect(profile).toContain("onPress: () => void submitSignOut()");
  });

  it('keeps About factual and offline: no API call, no cache controls without an offline store', () => {
    expect(about).not.toMatch(/\bapi\./);
    expect(about).not.toMatch(/clear|AsyncStorage|FileSystem/);
    expect(about).toContain('Constants.expoConfig?.version');
  });
});
