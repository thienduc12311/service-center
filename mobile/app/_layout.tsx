import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@service-center/shared';
import { AuthProvider, useAuth } from '../src/providers/AuthProvider';
import { Loading } from '../src/components/ui';
import { theme } from '../src/lib/theme';
import '../global.css';
import { useColorScheme } from 'nativewind';

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
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === 'dark';

  useEffect(() => {
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    // Reachable from an invite link before the user has a session — the
    // screen itself handles what to show if they're already signed in.
    const inAcceptInvite = segments[0] === 'accept-invite';

    if (!session && !inAuthGroup && !inAcceptInvite) router.replace('/(auth)/login');
    else if (session && inAuthGroup) router.replace('/(tabs)');
  }, [session, loading, segments, router]);

  if (loading) return <Loading label="Signing you in…" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: dark ? '#0f172a' : theme.colors.surface },
        headerTintColor: dark ? '#f8fafc' : theme.colors.text,
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: dark ? '#020617' : theme.colors.background },
      }}
    >
      <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="plan/[id]" options={{ title: 'Plan' }} />
      <Stack.Screen name="song/[id]" options={{ title: 'Song' }} />
      <Stack.Screen name="scan" options={{ title: 'Import chord sheet', presentation: 'modal' }} />
      <Stack.Screen name="songbooks/index" options={{ title: 'Song books' }} />
      <Stack.Screen name="songbooks/[id]" options={{ title: 'Song book' }} />
    </Stack>
  );
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="auto" />
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
