import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { ApiError, type InvitationPreview } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Loading } from '../components/ui';
import { Icon } from '../components/icons';
import { AuthLayout, BrandMark } from '../components/AuthLayout';
import { LocaleSwitcher, useRecipientLanguage } from '../i18n';
import { localizeAuthError } from './LoginPage';

type Stage =
  | 'loading'
  | 'legacy-set-password'
  | 'preview'
  | 'invalid'
  | 'expired'
  | 'already-used'
  | 'existing-account'
  | 'success';

type FailedStage = Extract<Stage, 'invalid' | 'expired' | 'already-used'>;

const STAGE_MESSAGE_KEY = {
  invalid: 'invite.invalid',
  expired: 'invite.expired',
  'already-used': 'invite.alreadyUsed',
} as const satisfies Record<FailedStage, string>;

/**
 * Handles two flows that both land here: the legacy member-invite email
 * (Supabase's own `inviteUserByEmail`, which establishes a session via its
 * hash-fragment redirect before this renders — see AuthProvider) and the
 * newer no-login-person invite (identified by a `?token=` query param).
 */
export const AcceptInvitePage = () => {
  const { t } = useTranslation(['auth', 'common']);
  const { session, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [stage, setStage] = useState<Stage>('loading');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Once the token is verified, show the page in the invited Person's saved language.
  useRecipientLanguage(preview ? preview.preferred_language : undefined);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (session && !token) {
        setStage('legacy-set-password');
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

  const submitLegacy = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await refreshUser();
      navigate('/', { replace: true });
    } catch (err) {
      setError(localizeAuthError(err, 'setPassword'));
    } finally {
      setBusy(false);
    }
  };

  const submitAccept = async (event: FormEvent) => {
    event.preventDefault();
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
      navigate('/', { replace: true });
    } catch (err) {
      setError(localizeAuthError(err, 'signIn'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout corner={<LocaleSwitcher />} hideBrand>
      <div className="mb-8 flex flex-col items-center text-center">
        <BrandMark size="lg" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{t('invite.setUpTitle')}</h1>
      </div>

      {stage === 'loading' && <Loading />}

      {(stage === 'invalid' || stage === 'expired' || stage === 'already-used') && (
        <div className="card flex flex-col items-center gap-3 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
          <span className="grid size-11 place-items-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25">
            <Icon name="alert" className="size-5" />
          </span>
          {t(STAGE_MESSAGE_KEY[stage])}
        </div>
      )}

      {stage === 'existing-account' && (
        <div className="card flex flex-col items-center gap-3 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
          <span className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25">
            <Icon name="check" className="size-5" />
          </span>
          {t('invite.existingAccount')}
          <Button size="lg" className="mt-2 w-full" onClick={() => navigate('/login')}>{t('invite.goToSignIn')}</Button>
        </div>
      )}

      {stage === 'legacy-set-password' && (
        <form onSubmit={submitLegacy} className="card space-y-5 p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:shadow-none">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('invite.legacyIntro')}</p>
          <div>
            <label className="label" htmlFor="password">
              {t('invite.password')}
            </label>
            <input
              id="password"
              type="password"
              className="input h-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <ErrorNotice error={error} />
          <Button type="submit" size="lg" loading={busy} className="w-full">
            {t('invite.finishSetup')}
          </Button>
        </form>
      )}

      {stage === 'preview' && preview && (
        <form onSubmit={submitAccept} className="card space-y-5 p-6 shadow-xl shadow-slate-900/5 sm:p-8 dark:shadow-none">
          <div className="surface-inset flex items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-200">
              <Icon name="mail" className="size-4" />
            </span>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <Trans
                t={t}
                i18nKey={preview.person_first_name ? 'invite.invitedNamed' : 'invite.invitedGeneric'}
                values={{
                  name: preview.person_first_name,
                  organization: preview.organization_name,
                  role: t(`common:roles.${preview.role}`),
                  email: preview.email,
                }}
                components={[<strong key="organization" className="text-slate-900 dark:text-white" />, <strong key="email" className="text-slate-900 dark:text-white" />]}
              />
            </p>
          </div>
          <div>
            <label className="label" htmlFor="password">
              {t('invite.password')}
            </label>
            <input
              id="password"
              type="password"
              className="input h-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <ErrorNotice error={error} />
          <Button type="submit" size="lg" loading={busy} className="w-full">
            {t('invite.createAccount')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};
