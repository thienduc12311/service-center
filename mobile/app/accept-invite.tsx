import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError, type InvitationPreview } from '@service-center/shared';
import { api } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/providers/AuthProvider';
import { Button, ErrorNotice, Loading } from '../src/components/ui';
import { theme } from '../src/lib/theme';

type Stage =
  | 'loading'
  | 'already-signed-in'
  | 'preview'
  | 'invalid'
  | 'expired'
  | 'already-used'
  | 'existing-account';

const STAGE_MESSAGE: Partial<Record<Stage, string>> = {
  invalid: "This invitation link isn't valid. Ask whoever invited you to send a new one.",
  expired: 'This invitation has expired. Ask whoever invited you to send a new one.',
  'already-used': 'This invitation has already been used.',
};

/**
 * Reached via the servicecenter:// custom scheme today, and (once
 * Universal/App Links are configured with a real domain) the same
 * https://…/accept-invite link the invite email already sends for web.
 */
export default function AcceptInviteScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [stage, setStage] = useState<Stage>('loading');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (session) {
        setStage('already-signed-in');
        return;
      }
      if (!token) {
        setStage('invalid');
        return;
      }
      try {
        const result = await api.previewInvitation(token);
        if (!active) return;
        setPreview(result);
        setStage('preview');
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiError && err.code === 'invitation_expired') setStage('expired');
        else if (err instanceof ApiError && err.code === 'invitation_used') setStage('already-used');
        else setStage('invalid');
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [session, token]);

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.acceptInvitation(token, { password });
      if (result.linked_existing_account) {
        setStage('existing-account');
        return;
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.email,
        password,
      });
      if (signInError) throw signInError;
      // No manual navigation — the root layout redirects to (tabs) once the
      // new session lands, same as a normal sign-in on the login screen.
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Text style={styles.logoText}>SC</Text>
        </View>
        <Text style={styles.title}>Set up your account</Text>

        {stage === 'loading' && <Loading />}

        {(stage === 'invalid' || stage === 'expired' || stage === 'already-used') && (
          <View style={styles.card}>
            <Text style={styles.body}>{STAGE_MESSAGE[stage]}</Text>
          </View>
        )}

        {stage === 'already-signed-in' && (
          <View style={styles.card}>
            <Text style={styles.body}>You&apos;re already signed in.</Text>
            <Button title="Go to the app" onPress={() => router.replace('/(tabs)')} />
          </View>
        )}

        {stage === 'existing-account' && (
          <View style={styles.card}>
            <Text style={styles.body}>
              An account with this email already exists — sign in with your existing password instead.
            </Text>
            <Button title="Go to sign in" onPress={() => router.replace('/(auth)/login')} />
          </View>
        )}

        {stage === 'preview' && preview && (
          <View style={styles.card}>
            <Text style={styles.body}>
              {preview.person_first_name}, you&apos;ve been invited to join {preview.organization_name} as a{' '}
              {preview.role}. Choose a password for {preview.email} to finish.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              placeholderTextColor={theme.colors.textFaint}
            />
            <ErrorNotice error={error} />
            <Button title="Create my account" onPress={() => void submit()} loading={busy} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  title: { textAlign: 'center', fontSize: 24, fontWeight: '700', marginTop: 16, marginBottom: 24, color: theme.colors.text },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 12,
  },
  body: { fontSize: 14, color: theme.colors.textMuted, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.colors.text,
  },
});
