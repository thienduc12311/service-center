import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { ApiError, LocalizedError } from '@service-center/shared';
import { AuthProvider, useAuth } from '../src/providers/AuthProvider';
import { NotificationsProvider } from '../src/providers/NotificationsProvider';
import { LanguageProvider } from '../src/i18n';
import { NavigationIntentProvider } from '../src/providers/NavigationIntentProvider';
import { AppearanceProvider, useAppearance } from '../src/providers/AppearanceProvider';
import { Button, ErrorNotice, Loading, Screen } from '../src/components/ui';
import { OfflineLibrary } from '../src/components/rehearsal/OfflineLibrary';
import { loadStoredOrganizationId } from '../src/lib/organization-storage';
import { useOfflinePackCleanup } from '../src/lib/useOfflinePack';
import { useScheduleWidgetSync } from '../src/lib/useScheduleWidgetSync';
import { fonts } from '../src/lib/theme';
import { useTheme } from '../src/lib/useTheme';
import '../global.css';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

/**
 * Status bar text contrasts with the app's scheme, not the OS's. Mounted only
 * once the saved appearance is restored, so the splash hides on the right scheme.
 */
const AppStatusBar = () => {
  const { resolved } = useAppearance();
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />;
};

/**
 * MOB-025: the account could not be confirmed (usually no connection at
 * start). Offline packs this person downloaded for their last organization
 * still play from the device; nothing is fetched or written here.
 */
interface OfflineFallbackProps {
  userId: string;
  onBack: () => void;
}

const OfflineFallback = ({ userId, onBack }: OfflineFallbackProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const [organizationId, setOrganizationId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void loadStoredOrganizationId(userId).then(
      (stored) => active && setOrganizationId(stored),
      () => active && setOrganizationId(null),
    );
    return () => {
      active = false;
    };
  }, [userId]);
  return (
    <Screen safeTop>
      <View style={{ paddingHorizontal: 24, paddingTop: 8 }}>
        <Button variant="secondary" title={t('common:actions.back')} onPress={onBack} />
      </View>
      {organizationId === undefined ? <Loading /> : <OfflineLibrary userId={userId} organizationId={organizationId} mode="offline" />}
    </Screen>
  );
};

/** Keeps the navigator and the session in sync in both directions. */
const RootNavigator = () => {
  const { session, loading, ready, error, retry, generation } = useAuth();
  const [offlineOpen, setOfflineOpen] = useState(false);
  useOfflinePackCleanup();
  useScheduleWidgetSync();
  const segments = useSegments();
  const router = useRouter();
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'common', 'settings', 'scheduling', 'reports', 'media']);

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    // Reachable from an invite link before the user has a session — the
    // screen itself handles what to show if they're already signed in.
    const inPublicRoute = ['accept-invite', 'respond', 'link-result'].includes(
      String(segments[0]),
    );

    if (!session && !inAuthGroup && !inPublicRoute) router.replace('/(auth)/login');
    else if (session && inAuthGroup) router.replace('/(tabs)');
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.canvas, justifyContent: 'center' }}>
        <Loading label={t('common:states.signingIn')} />
      </View>
    );
  }

  if (session && !ready) {
    if (offlineOpen) return <OfflineFallback userId={session.user.id} onBack={() => setOfflineOpen(false)} />;
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.canvas, justifyContent: 'center', padding: 24, gap: 16 }}>
        <ErrorNotice error={error ?? new LocalizedError({ key: 'auth:root.accountLoadFailed' })} />
        <Button title={t('common:actions.retry')} onPress={() => void retry()} />
        <Button variant="secondary" title={t('settings:offlineDownloads.offlineEntry')} onPress={() => setOfflineOpen(true)} />
      </View>
    );
  }

  return (
    <Stack
      key={`session-${generation}`}
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.surface },
        headerShadowVisible: true,
        headerTintColor: theme.color.brandText,
        headerTitleStyle: { fontFamily: fonts.sansMedium, fontWeight: '600', fontSize: 16, color: theme.color.ink },
        headerBackTitle: t('common:actions.back'),
        contentStyle: { backgroundColor: theme.color.canvas },
      }}
    >
      <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: false }} />
      <Stack.Screen name="respond" options={{ headerShown: false }} />
      <Stack.Screen name="link-result" options={{ title: t('link.screenTitle') }} />
      <Stack.Screen name="open/plan/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="plan/[id]" options={{ title: t('root.screens.plan') }} />
      <Stack.Screen name="song/[id]" options={{ title: t('root.screens.song') }} />
      <Stack.Screen name="notifications" options={{ title: t('common:nav.notifications') }} />
      <Stack.Screen name="team-preferences" options={{ title: t('settings:preferences.screenTitle') }} />
      <Stack.Screen name="notification-settings" options={{ title: t('settings:mobileNotifications.screenTitle') }} />
      <Stack.Screen name="about" options={{ title: t('settings:about.screenTitle') }} />
      <Stack.Screen name="offline-downloads" options={{ title: t('settings:offlineDownloads.screenTitle') }} />
      <Stack.Screen name="calendar-subscription" options={{ title: t('scheduling:mobileSubscription.screenTitle') }} />
      <Stack.Screen name="schedule-report" options={{ title: t('reports:mobileReport.screenTitle') }} />
      <Stack.Screen name="files/[id]" options={{ title: t('media:filesPanel.title') }} />
      <Stack.Screen name="files/add" options={{ title: t('media:addFile.titles.upload') }} />
    </Stack>
  );
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppearanceProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LanguageProvider>
              <NotificationsProvider>
                <NavigationIntentProvider>
                  <AppStatusBar />
                  <RootNavigator />
                </NavigationIntentProvider>
              </NotificationsProvider>
            </LanguageProvider>
          </AuthProvider>
        </QueryClientProvider>
      </AppearanceProvider>
    </SafeAreaProvider>
  );
}
