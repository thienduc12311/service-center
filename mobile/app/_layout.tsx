import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { ApiError } from '@service-center/shared';
import { AuthProvider, useAuth } from '../src/providers/AuthProvider';
import { NotificationsProvider } from '../src/providers/NotificationsProvider';
import { Loading } from '../src/components/ui';
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

/** Keeps the navigator and the session in sync in both directions. */
const RootNavigator = () => {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const theme = useTheme();

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    // Reachable from an invite link before the user has a session — the
    // screen itself handles what to show if they're already signed in.
    const inAcceptInvite = segments[0] === 'accept-invite';

    if (!session && !inAuthGroup && !inAcceptInvite) router.replace('/(auth)/login');
    else if (session && inAuthGroup) router.replace('/(tabs)');
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.color.canvas, justifyContent: 'center' }}>
        <Loading label="Signing you in" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.color.surface },
        headerShadowVisible: true,
        headerTintColor: theme.color.brandText,
        headerTitleStyle: { fontFamily: fonts.sansMedium, fontWeight: '600', fontSize: 16, color: theme.color.ink },
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: theme.color.canvas },
      }}
    >
      <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="plan/[id]" options={{ title: 'Plan' }} />
      <Stack.Screen name="song/[id]" options={{ title: 'Song' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="songbooks/[id]" options={{ title: 'Song book' }} />
    </Stack>
  );
};

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NotificationsProvider>
            <StatusBar style="auto" />
            <RootNavigator />
          </NotificationsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
