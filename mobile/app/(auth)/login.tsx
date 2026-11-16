import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { LocalizedError, passwordResetRedirectUrl, type QualifiedTranslationKey } from '@service-center/shared';
import { supabase } from '../../src/lib/supabase';
import { env } from '../../src/lib/env';
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
export type AuthAction = 'signIn' | 'signUp' | 'setPassword' | 'resetPassword';

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
  resetPassword: 'auth:authErrors.resetFailed',
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
  /** Showing "reset your password" instead of the sign-in form. */
  const [forgot, setForgot] = useState(false);

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
    setForgot(false);
    setError(null);
    setNotice(null);
  };

  /**
   * Sends Supabase's reset email. Its link opens the web app's reset page
   * (no app deep link needed); the same answer whether or not the address
   * has an account.
   */
  const sendReset = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const address = email.trim();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: env.webAppDomain ? passwordResetRedirectUrl(`https://${env.webAppDomain}`) : undefined,
      });
      if (resetError) throw resetError;
      setNotice(`${t('passwordReset.forgot.sent', { email: address })}\n\n${t('passwordReset.forgot.openOnWeb')}`);
    } catch (err) {
      setError(localizeAuthError(err, 'resetPassword'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen safeTop>
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
            {forgot ? (
            <Card>
              <Text accessibilityRole="header" style={styles.cardTitle}>{t('passwordReset.forgot.title')}</Text>
              <Text style={styles.cardIntro}>{t('passwordReset.forgot.intro')}</Text>
              <Field
                label={t('login.fields.email')}
                value={email}
                onChangeText={setEmail}
                placeholder={t('login.fields.emailPlaceholder')}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <ErrorNotice error={error} />
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}
              {notice ? null : (
                <Button title={t('passwordReset.forgot.submit')} onPress={() => void sendReset()} loading={busy} />
              )}
              <Pressable accessibilityRole="button" onPress={() => switchMode('sign-in')} style={styles.switchTarget}>
                <Text style={styles.switch}>{t('passwordReset.forgot.backToSignIn')}</Text>
              </Pressable>
            </Card>
            ) : (
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
              {mode === 'sign-in' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setForgot(true);
                    setError(null);
                    setNotice(null);
                  }}
                  style={styles.forgotTarget}
                >
                  <Text style={styles.switch}>{t('passwordReset.forgot.link')}</Text>
                </Pressable>
              ) : null}

              <ErrorNotice error={error} />
              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <Button
                title={mode === 'sign-in' ? t('login.submitSignIn') : t('login.submitSignUp')}
                onPress={() => void submit()}
                loading={busy}
              />
            </Card>
            )}
          </Reveal>

          {forgot ? null : (
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
          )}
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
    masthead: { alignItems: 'center', gap: theme.space.xs, paddingTop: theme.space.lg },
    brandMark: {
      width: 64, height: 64, borderRadius: theme.radius.lg + 4,
      backgroundColor: theme.color.brand, alignItems: 'center', justifyContent: 'center',
      marginBottom: theme.space.md,
      shadowColor: theme.color.brand,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: theme.scheme === 'dark' ? 0 : 0.25,
      shadowRadius: 14,
      elevation: theme.scheme === 'dark' ? 0 : 4,
    },
    brandLetters: { ...theme.type.title, fontSize: 22, fontWeight: '700', color: theme.color.onBrand },
    title: { ...theme.type.display, color: theme.color.ink, textAlign: 'center' },
    subtitle: { ...theme.type.body, color: theme.color.inkMuted, textAlign: 'center' },
    notice: {
      ...theme.type.bodySmall,
      color: theme.accent.green.fg,
      backgroundColor: theme.accent.green.bg,
      borderRadius: theme.radius.md,
      padding: theme.space.md,
    },
    switchTarget: { minHeight: 44, justifyContent: 'center' },
    forgotTarget: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end' },
    cardTitle: { ...theme.type.title, color: theme.color.ink },
    cardIntro: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    switch: { ...theme.type.bodySmall, fontWeight: '600', color: theme.color.brandText, textAlign: 'center' },
  });
