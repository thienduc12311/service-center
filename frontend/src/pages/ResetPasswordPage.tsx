import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MIN_PASSWORD_LENGTH, newPasswordProblem, passwordResetLinkFailed, type NewPasswordProblem } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { LocaleSwitcher } from '../i18n';
import { Button, ErrorNotice, Loading, Notice } from '../components/ui';
import { AuthLayout } from '../components/AuthLayout';
import { localizeAuthError } from './LoginPage';

type LinkState = 'checking' | 'ready' | 'invalid';

/** How long to wait for Supabase to turn the link into a session before calling it broken. */
const LINK_TIMEOUT_MS = 4000;

/**
 * Where the reset email's link lands. Supabase signs the person in from the
 * link (a recovery session); they choose a new password here. Outside the
 * signed-in routes on purpose, so nothing redirects them away first.
 */
export const ResetPasswordPage = () => {
  const { t } = useTranslation(['auth']);
  const navigate = useNavigate();
  const [linkState, setLinkState] = useState<LinkState>(() =>
    passwordResetLinkFailed(window.location) ? 'invalid' : 'checking',
  );
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problem, setProblem] = useState<NewPasswordProblem | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (linkState !== 'checking') return;
    let settled = false;
    const settle = (next: LinkState) => {
      if (settled) return;
      settled = true;
      setLinkState(next);
    };
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) settle('ready');
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) settle('ready');
    });
    const timer = window.setTimeout(() => settle('invalid'), LINK_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
      subscription.subscription.unsubscribe();
    };
  }, [linkState]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const found = newPasswordProblem(password, confirmation);
    setProblem(found);
    if (found) return;
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
    } catch (err) {
      setError(localizeAuthError(err, 'setPassword'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout corner={<LocaleSwitcher />}>
      <div className="card space-y-5 p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:shadow-none">
        {linkState === 'checking' && <Loading label={t('passwordReset.reset.checking')} />}

        {linkState === 'invalid' && (
          <>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t('passwordReset.reset.invalidTitle')}</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('passwordReset.reset.invalidBody')}</p>
            </div>
            <Link to="/forgot-password" className="button inline-flex h-11 w-full items-center justify-center bg-brand-600 font-medium text-white hover:bg-brand-700">
              {t('passwordReset.reset.requestNew')}
            </Link>
          </>
        )}

        {linkState === 'ready' && done && (
          <>
            <Notice tone="success">{t('passwordReset.reset.done')}</Notice>
            <Button size="lg" className="w-full" onClick={() => navigate('/', { replace: true })}>
              {t('passwordReset.reset.continue')}
            </Button>
          </>
        )}

        {linkState === 'ready' && !done && (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t('passwordReset.reset.title')}</h1>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('passwordReset.reset.intro')}</p>
            </div>
            <div>
              <label className="label" htmlFor="new-password">{t('passwordReset.reset.newPassword')}</label>
              <input
                id="new-password"
                type="password"
                className="input h-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="confirm-password">{t('passwordReset.reset.confirmPassword')}</label>
              <input
                id="confirm-password"
                type="password"
                className="input h-11"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </div>
            {problem && <Notice tone="warning">{t(`passwordReset.reset.${problem}`)}</Notice>}
            <ErrorNotice error={error} />
            <Button type="submit" size="lg" loading={busy} className="w-full">
              {t('passwordReset.reset.submit')}
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
};
