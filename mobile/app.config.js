require('dotenv/config');

// Universal Links (iOS) / App Links (Android) let the accept-invite email's
// https:// link open this app directly instead of a browser. They only take
// effect in a real native build (EAS build / `expo prebuild`), not
// `expo start`, and require WEB_APP_DOMAIN to point at a real domain that
// hosts the verification files under frontend/public/.well-known/ — so this
// is left unset (and the associated-domain config omitted) for local dev.
const webAppDomain = process.env.WEB_APP_DOMAIN;

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'Service Center',
  slug: 'service-center',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'servicecenter',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.servicecenter.app',
    infoPlist: {
      NSCameraUsageDescription: 'Take a photo of a chord sheet to import it.',
      NSPhotoLibraryUsageDescription: 'Choose a photo of a chord sheet to import it.',
    },
    ...(webAppDomain ? { associatedDomains: [`applinks:${webAppDomain}`] } : {}),
  },
  android: {
    package: 'com.servicecenter.app',
    adaptiveIcon: { backgroundColor: '#FBFBFA' },
    ...(webAppDomain
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [{ scheme: 'https', host: webAppDomain, pathPrefix: '/accept-invite' }],
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
    ['expo-notifications', { color: '#191918' }],
    'expo-status-bar',
    ['expo-splash-screen', { backgroundColor: '#FBFBFA', dark: { backgroundColor: '#151513' } }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: '',
    apiUrl: 'http://localhost:4000',
  },
};

module.exports = { expo: config };
