import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { LocalizedError, type QualifiedTranslationKey } from '@service-center/shared';
import { supabase } from '../../src/lib/supabase';
import { LanguageSelector } from '../../src/i18n';
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

/** Which Supabase Auth call failed; picks the generic fallback message. */
export type AuthAction = 'signIn' | 'signUp' | 'setPassword';

const AUTH_CODE_KEYS: Readonly<Record<string, QualifiedTranslationKey>> = {
  invalid_credentials: 'auth:authErrors.invalidCredentials',
  email_not_confirmed: 'auth:authErrors.emailNotConfirmed',
  user_already_exists: 'auth:authErrors.accountExists',
  email_exists: 'auth:authErrors.accountExists',
  weak_password: 'auth:authErrors.weakPassword',
  same_password: 'auth:authErrors.samePassword',
  signup_disabled: 'auth:authErrors.signupDisabled',
  email_address_invalid: 'auth:authErrors.invalidEmail',
  over_request_rate_limit: 'auth:authErrors.rateLimited',
  over_email_send_rate_limit: 'auth:authErrors.rateLimited',
};

const AUTH_FALLBACK_KEYS: Readonly<Record<AuthAction, QualifiedTranslationKey>> = {
  signIn: 'auth:authErrors.signInFailed',
  signUp: 'auth:authErrors.signUpFailed',
  setPassword: 'auth:authErrors.setPasswordFailed',
};

/**
 * Supabase Auth errors carry provider-written English text. Map the codes we
 * recognize to our own catalog keys, and anything else to a localized
 * generic failure, so raw provider text never reaches the screen. Non-Auth
 * errors (e.g. ApiError) pass through for `<ErrorNotice>` to localize.
 */
export const localizeAuthError = (error: unknown, action: AuthAction): unknown => {
  if (!isAuthError(error)) return error;
  if (isAuthRetryableFetchError(error)) return new LocalizedError({ key: 'errors:generic.network' });
  const key = (error.code ? AUTH_CODE_KEYS[error.code] : undefined) ?? AUTH_FALLBACK_KEYS[action];
  return new LocalizedError({ key });
};

export default function LoginScreen() {
  const { t } = useTranslation(['auth', 'common']);
  const styles = useThemedStyles(makeStyles);
  const modes: readonly SegmentOption<AuthMode>[] = [
    { value: 'sign-in', label: t('login.modes.signIn') },
    { value: 'sign-up', label: t('login.modes.signUp') },
  ];
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
        if (!data.session) setNotice(t('login.checkEmail'));
      }
    } catch (err) {
      setError(localizeAuthError(err, mode === 'sign-in' ? 'signIn' : 'signUp'));
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
              <Text accessibilityRole="header" style={styles.title}>{t('common:app.name')}</Text>
              <Text style={styles.subtitle}>{t('brand.tagline')}</Text>
            </View>
          </Reveal>

          <Reveal index={1}>
            <Card>
              <SegmentedControl options={modes} value={mode} onChange={switchMode} />

              {mode === 'sign-up' ? (
                <Field
                  label={t('login.fields.fullName')}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t('login.fields.fullNamePlaceholder')}
                  autoComplete="name"
                />
              ) : null}

              <Field
                label={t('login.fields.email')}
                value={email}
                onChangeText={setEmail}
                placeholder={t('login.fields.emailPlaceholder')}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <Field
                label={t('login.fields.password')}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              />

              <ErrorNotice error={error} />
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <Button
                title={mode === 'sign-in' ? t('login.submitSignIn') : t('login.submitSignUp')}
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
                  ? t('login.switchToSignUpLong')
                  : t('login.switchToSignInLong')}
              </Text>
            </Pressable>
          </Reveal>

          <Reveal index={3}>
            <LanguageSelector />
          </Reveal>

          <Text style={styles.seedHint}>
            {t('login.demoLogin', { email: 'avery@example.com', password: 'password123' })}
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
