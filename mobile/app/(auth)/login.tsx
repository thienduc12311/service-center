import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { Button, ErrorNotice } from '../../src/components/ui';
import { theme } from '../../src/lib/theme';

export default function LoginScreen() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        if (!data.session) setNotice('Check your email to confirm your account.');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Text style={styles.logoText}>SC</Text>
        </View>
        <Text style={styles.title}>Service Center</Text>
        <Text style={styles.subtitle}>Plan services. Schedule your team.</Text>

        <View style={styles.form}>
          {mode === 'sign-up' && (
            <TextInput
              style={styles.input}
              placeholder="Full name"
              value={fullName}
              onChangeText={setFullName}
              autoComplete="name"
              placeholderTextColor={theme.colors.textFaint}
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholderTextColor={theme.colors.textFaint}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={theme.colors.textFaint}
          />

          <ErrorNotice error={error} />
          {notice && <Text style={styles.notice}>{notice}</Text>}

          <Button
            title={mode === 'sign-in' ? 'Sign in' : 'Create account'}
            onPress={submit}
            loading={busy}
          />

          <Pressable
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
              setNotice(null);
            }}
          >
            <Text style={styles.switch}>
              {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>Demo: avery@example.com · password123</Text>
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
  title: { textAlign: 'center', fontSize: 24, fontWeight: '700', marginTop: 16, color: theme.colors.text },
  subtitle: { textAlign: 'center', color: theme.colors.textMuted, marginTop: 4, marginBottom: 24 },
  form: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: theme.colors.text,
  },
  notice: { color: theme.colors.success, fontSize: 14 },
  switch: { textAlign: 'center', color: theme.colors.brand, fontWeight: '600', paddingTop: 4 },
  hint: { textAlign: 'center', color: theme.colors.textFaint, fontSize: 12, marginTop: 24 },
});
