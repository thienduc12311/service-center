import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { passwordResetRedirectUrl } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { LocaleSwitcher } from '../i18n';
import { Button, ErrorNotice, Notice } from '../components/ui';
import { AuthLayout } from '../components/AuthLayout';
import { localizeAuthError } from './LoginPage';

/**
 * Sends Supabase's password-reset email. The answer is the same whether or
 * not the address has an account, so this page can't be used to find out
 * who has one.
 */
export const ForgotPasswordPage = () => {
  const { t } = useTranslation(['auth']);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const address = email.trim();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: passwordResetRedirectUrl(window.location.origin),
      });
      if (resetError) throw resetError;
      setSentTo(address);
    } catch (err) {
      setError(localizeAuthError(err, 'resetPassword'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout corner={<LocaleSwitcher />}>
      <form onSubmit={submit} className="card space-y-5 p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:shadow-none">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t('passwordReset.forgot.title')}</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{t('passwordReset.forgot.intro')}</p>
        </div>

        {sentTo ? (
          <Notice tone="success">{t('passwordReset.forgot.sent', { email: sentTo })}</Notice>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="reset-email">{t('login.fields.email')}</label>
              <input
                id="reset-email"
                type="email"
                className="input h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <ErrorNotice error={error} />
            <Button type="submit" size="lg" loading={busy} className="w-full">
              {t('passwordReset.forgot.submit')}
            </Button>
          </>
        )}
      </form>

      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-200">
          {t('passwordReset.forgot.backToSignIn')}
        </Link>
      </p>
    </AuthLayout>
  );
};
