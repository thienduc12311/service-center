import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { LocalizedError, type QualifiedTranslationKey } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { LocaleSwitcher } from '../i18n';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice } from '../components/ui';

type Mode = 'sign-in' | 'sign-up';

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
 * generic failure, so raw provider text never reaches the page. Non-Auth
 * errors (e.g. ApiError) pass through for `<ErrorNotice>` to localize.
 */
export const localizeAuthError = (error: unknown, action: AuthAction): unknown => {
  if (!isAuthError(error)) return error;
  if (isAuthRetryableFetchError(error)) return new LocalizedError({ key: 'errors:generic.network' });
  const key = (error.code ? AUTH_CODE_KEYS[error.code] : undefined) ?? AUTH_FALLBACK_KEYS[action];
  return new LocalizedError({ key });
};

export const LoginPage = () => {
  const { t } = useTranslation(['auth', 'common']);
  const { session } = useAuth();
  const location = useLocation() as { state?: { from?: string } };
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={location.state?.from ?? '/'} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        // With email confirmation on, there is no session until they click.
        if (!data.session) setNotice(t('login.checkEmail'));
      }
    } catch (err) {
      setError(localizeAuthError(err, mode === 'sign-in' ? 'signIn' : 'signUp'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-full place-items-center px-4 py-12">
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            SC
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('common:app.name')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('brand.tagline')}</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {mode === 'sign-up' && (
            <div>
              <label className="label" htmlFor="full-name">{t('login.fields.fullName')}</label>
              <input
                id="full-name"
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
          )}

          <div>
            <label className="label" htmlFor="email">{t('login.fields.email')}</label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">{t('login.fields.password')}</label>
            <input
              id="password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              minLength={8}
              required
            />
          </div>

          <ErrorNotice error={error} />
          {notice && (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>
          )}

          <Button type="submit" loading={busy} className="w-full">
            {mode === 'sign-in' ? t('login.submitSignIn') : t('login.submitSignUp')}
          </Button>

          <p className="text-center text-sm text-slate-500">
            {mode === 'sign-in' ? t('login.noAccount') : t('login.haveAccount')}{' '}
            <button
              type="button"
              className="font-medium text-brand-600 hover:underline"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setError(null);
                setNotice(null);
              }}
            >
              {mode === 'sign-in' ? t('login.switchToSignUp') : t('login.switchToSignIn')}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
};
