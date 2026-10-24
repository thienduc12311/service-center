require('dotenv/config');

// Universal Links (iOS) / App Links (Android) let the accept-invite email's
// https:// link open this app directly instead of a browser. They only take
// effect in a real native build (EAS build / `expo prebuild`), not
// `expo start`, and require WEB_APP_DOMAIN to point at a real domain that
// hosts the verification files under frontend/public/.well-known/ — so this
// is left unset (and the associated-domain config omitted) for local dev.
const webAppDomain = process.env.EXPO_PUBLIC_WEB_APP_DOMAIN || process.env.WEB_APP_DOMAIN;

if (webAppDomain && !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(webAppDomain)) {
  throw new Error('EXPO_PUBLIC_WEB_APP_DOMAIN must be a hostname without a protocol or path.');
}

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'Service Center',
  slug: 'service-center',
  owner: 'thienduc12311',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'servicecenter',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.servicecenter.app',
    // HTTPS only — exempt from export-compliance documentation, so TestFlight
    // doesn't ask on every build.
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      NSCameraUsageDescription: 'Take a photo of a chord sheet to import it.',
      NSPhotoLibraryUsageDescription: 'Choose a photo of a chord sheet to import it.',
    },
    ...(webAppDomain ? { associatedDomains: [`applinks:${webAppDomain}`] } : {}),
  },
  android: {
    package: 'com.servicecenter.app',
    adaptiveIcon: { backgroundColor: '#f8fafc' },
    ...(webAppDomain
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [
                { scheme: 'https', host: webAppDomain, path: '/accept-invite' },
                { scheme: 'https', host: webAppDomain, path: '/respond' },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  plugins: [
    'expo-router',
    // The notification icon/colour only apply to a native build; in Expo Go
    // the default OS presentation is used.
    ['expo-notifications', { color: '#4f46e5' }],
    // MOB-024 rehearsal player: background playback (iOS `audio` background
    // mode, Android media-playback foreground service). Playback only — the
    // app never records, so no microphone permission is requested.
    // Applies to a native build; Expo Go ships its own configuration.
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: true }],
    'expo-status-bar',
    ['expo-splash-screen', { backgroundColor: '#f8fafc', dark: { backgroundColor: '#020617' } }],
    // MOB-033: one iOS WidgetKit extension fed by snapshots the app writes into
    // the shared app group (no network or sign-in inside the extension). Needs a
    // development/release build; Expo Go has no widget extension. Android
    // widgets are a separate, unselected stage.
    [
      'expo-widgets',
      {
        groupIdentifier: 'group.com.servicecenter.app',
        widgets: [
          {
            name: 'ServiceCenterSchedule',
            displayName: 'Next serving',
            description: 'Your next services and a rehearsal shortcut.',
            ios: { supportedFamilies: ['systemSmall', 'systemMedium', 'accessoryRectangular'] },
          },
        ],
      },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: '',
    apiUrl: 'http://localhost:4000',
    webAppDomain,
    eas: { projectId: '31103a65-05de-4a27-bc00-3cb9a1c830a0' },
  },
};

module.exports = { expo: config };
