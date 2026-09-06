import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, type InvitationPreview } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Loading } from '../components/ui';

type Stage =
  | 'loading'
  | 'legacy-set-password'
  | 'preview'
  | 'invalid'
  | 'expired'
  | 'already-used'
  | 'existing-account'
  | 'success';

const STAGE_MESSAGE: Partial<Record<Stage, string>> = {
  invalid: "This invitation link isn't valid. Ask whoever invited you to send a new one.",
  expired: 'This invitation has expired. Ask whoever invited you to send a new one.',
  'already-used': 'This invitation has already been used.',
};

/**
 * Handles two flows that both land here: the legacy member-invite email
 * (Supabase's own `inviteUserByEmail`, which establishes a session via its
 * hash-fragment redirect before this renders — see AuthProvider) and the
 * newer no-login-person invite (identified by a `?token=` query param).
 */
export const AcceptInvitePage = () => {
  const { session, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [stage, setStage] = useState<Stage>('loading');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

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
      setError(err);
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
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            SC
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Set up your account</h1>
        </div>

        {stage === 'loading' && <Loading />}

        {(stage === 'invalid' || stage === 'expired' || stage === 'already-used') && (
          <div className="card p-6 text-center text-sm text-slate-600">{STAGE_MESSAGE[stage]}</div>
        )}

        {stage === 'existing-account' && (
          <div className="card p-6 text-center text-sm text-slate-600">
            An account with this email already exists — sign in with your existing password instead.
            <div className="mt-4">
              <Button onClick={() => navigate('/login')}>Go to sign in</Button>
            </div>
          </div>
        )}

        {stage === 'legacy-set-password' && (
          <form onSubmit={submitLegacy} className="card space-y-4 p-6">
            <p className="text-sm text-slate-500">Choose a password to finish setting up your account.</p>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <ErrorNotice error={error} />
            <Button type="submit" loading={busy} className="w-full">
              Finish setting up
            </Button>
          </form>
        )}

        {stage === 'preview' && preview && (
          <form onSubmit={submitAccept} className="card space-y-4 p-6">
            <p className="text-sm text-slate-500">
              {preview.person_first_name}, you&apos;ve been invited to join <strong>{preview.organization_name}</strong> as
              a {preview.role}. Choose a password for <strong>{preview.email}</strong> to finish.
            </p>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <ErrorNotice error={error} />
            <Button type="submit" loading={busy} className="w-full">
              Create my account
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};
