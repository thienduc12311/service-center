import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
// Imported per weight rather than from each package root, so the bundle
// carries only the six faces the type scale actually uses.
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono/400Regular';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
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
        headerStyle: { backgroundColor: theme.color.canvas },
        headerShadowVisible: false,
        headerTintColor: theme.color.ink,
        headerTitleStyle: { fontFamily: fonts.sansMedium, fontSize: 16 },
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
      <Stack.Screen name="scan" options={{ title: 'Import chord sheet', presentation: 'modal' }} />
      <Stack.Screen name="songbooks/[id]" options={{ title: 'Song book' }} />
    </Stack>
  );
};

export default function RootLayout() {
  // The whole type system depends on these, so nothing renders until they are
  // resolved — a flash of the fallback system font would undo the hierarchy.
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
    InstrumentSerif_400Regular,
  });

  const onReady = useCallback(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onReady();
  }, [onReady]);

  if (!fontsLoaded && !fontError) return null;

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
