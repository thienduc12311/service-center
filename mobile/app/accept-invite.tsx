import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError, type InvitationPreview } from '@service-center/shared';
import { api } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/providers/AuthProvider';
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  Label,
  Loading,
  RuledField,
  Screen,
} from '../src/components/ui';
import { Reveal } from '../src/components/motion';
import type { Theme } from '../src/lib/theme';
import { useThemedStyles } from '../src/lib/useTheme';

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
  const styles = useThemedStyles(makeStyles);
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [stage, setStage] = useState<Stage>('loading');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
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

  const submit = async (): Promise<void> => {
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

  const headline =
    stage === 'preview' && preview
      ? `${preview.person_first_name}, you're invited`
      : 'Set up your account';

  return (
    <Screen>
      <RuledField height={300} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Reveal>
            <View style={styles.masthead}>
              <Label>Service Center</Label>
              <Text style={styles.title}>{headline}</Text>
            </View>
          </Reveal>

          {stage === 'loading' ? <Loading label="Checking your invitation" /> : null}

          {stage === 'invalid' || stage === 'expired' || stage === 'already-used' ? (
            <Reveal index={1}>
              <Card>
                <Text style={styles.body}>{STAGE_MESSAGE[stage]}</Text>
              </Card>
            </Reveal>
          ) : null}

          {stage === 'already-signed-in' ? (
            <Reveal index={1}>
              <Card>
                <Text style={styles.body}>You&apos;re already signed in.</Text>
                <Button title="Go to the app" onPress={() => router.replace('/(tabs)')} />
              </Card>
            </Reveal>
          ) : null}

          {stage === 'existing-account' ? (
            <Reveal index={1}>
              <Card>
                <Text style={styles.body}>
                  An account with this email already exists — sign in with your existing password
                  instead.
                </Text>
                <Button title="Go to sign in" onPress={() => router.replace('/(auth)/login')} />
              </Card>
            </Reveal>
          ) : null}

          {stage === 'preview' && preview ? (
            <Reveal index={1}>
              <Card>
                <Text style={styles.body}>
                  {`You've been invited to join ${preview.organization_name} as a ${preview.role}. Choose a password for ${preview.email} to finish.`}
                </Text>
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry
                  autoComplete="new-password"
                />
                <ErrorNotice error={error} />
                <Button title="Create my account" onPress={() => void submit()} loading={busy} />
              </Card>
            </Reveal>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: theme.space.xl,
      gap: theme.space.xxl,
    },
    masthead: { gap: theme.space.md },
    title: { ...theme.type.display, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.inkMuted },
  });
