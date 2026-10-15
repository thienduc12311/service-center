import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import {
  Button,
  Card,
  ErrorNotice,
  Field,
  Screen,
  SegmentedControl,
  type SegmentOption,
} from '../../src/components/ui';
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useThemedStyles } from '../../src/lib/useTheme';

type AuthMode = 'sign-in' | 'sign-up';

const MODES: readonly SegmentOption<AuthMode>[] = [
  { value: 'sign-in', label: 'Sign in' },
  { value: 'sign-up', label: 'Create account' },
];

export default function LoginScreen() {
  const styles = useThemedStyles(makeStyles);
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) setNotice('Check your email to confirm your account.');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: AuthMode): void => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Reveal>
            <View style={styles.masthead}>
              <View style={styles.brandMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {/* A fixed-size logo glyph; the heading below carries the name at any text size. */}
                <Text style={styles.brandLetters} maxFontSizeMultiplier={1}>SC</Text>
              </View>
              <Text accessibilityRole="header" style={styles.title}>Service Center</Text>
              <Text style={styles.subtitle}>Plan services. Schedule your team.</Text>
            </View>
          </Reveal>

          <Reveal index={1}>
            <Card>
              <SegmentedControl options={MODES} value={mode} onChange={switchMode} />

              {mode === 'sign-up' ? (
                <Field
                  label="Full name"
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder="Your name"
                  autoComplete="name"
                />
              ) : null}

              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@church.org"
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              />

              <ErrorNotice error={error} />
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <Button
                title={mode === 'sign-in' ? 'Sign in' : 'Create account'}
                onPress={() => void submit()}
                loading={busy}
              />
            </Card>
          </Reveal>

          <Reveal index={2}>
            <Pressable
              accessibilityRole="button"
              onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
              style={styles.switchTarget}
            >
              <Text style={styles.switch}>
                {mode === 'sign-in'
                  ? 'New here? Create an account'
                  : 'Already have an account? Sign in'}
              </Text>
            </Pressable>
          </Reveal>

          <Text style={styles.seedHint}>
            Seeded local account — avery@example.com / password123
          </Text>
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
      // Keeps the form a readable column on tablets instead of edge to edge.
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      padding: theme.space.xl,
      gap: theme.space.xxl,
    },
    masthead: { alignItems: 'center', gap: theme.space.sm, paddingTop: theme.space.lg },
    brandMark: {
      width: 48, height: 48, borderRadius: theme.radius.md,
      backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center',
      marginBottom: theme.space.sm,
    },
    brandLetters: { ...theme.type.heading, fontSize: 18, color: theme.color.onBrand },
    title: { ...theme.type.display, fontSize: 24, color: theme.color.ink },
    subtitle: { ...theme.type.bodySmall, color: theme.color.inkMuted, textAlign: 'center' },
    notice: { ...theme.type.bodySmall, color: theme.accent.green.fg },
    switchTarget: { minHeight: 44, justifyContent: 'center' },
    switch: { ...theme.type.bodySmall, color: theme.color.inkMuted, textAlign: 'center' },
    seedHint: {
      ...theme.type.numeric,
      fontSize: 11,
      color: theme.color.inkFaint,
      textAlign: 'center',
    },
  });
