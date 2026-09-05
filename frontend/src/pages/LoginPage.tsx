import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice } from '../components/ui';

type Mode = 'sign-in' | 'sign-up';

export const LoginPage = () => {
  const { session } = useAuth();
  const location = useLocation() as { state?: { from?: string } };
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState<string | null>(null);
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
        if (!data.session) setNotice('Check your email to confirm your account.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Service Center</h1>
          <p className="mt-1 text-sm text-slate-500">Plan services. Schedule your team.</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {mode === 'sign-up' && (
            <div>
              <label className="label" htmlFor="full-name">Full name</label>
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
            <label className="label" htmlFor="email">Email</label>
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
            <label className="label" htmlFor="password">Password</label>
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

          {error && <ErrorNotice error={error} />}
          {notice && (
            <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>
          )}

          <Button type="submit" loading={busy} className="w-full">
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </Button>

          <p className="text-center text-sm text-slate-500">
            {mode === 'sign-in' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              className="font-medium text-brand-600 hover:underline"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
                setError(null);
                setNotice(null);
              }}
            >
              {mode === 'sign-in' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Demo login: avery@example.com · password123
        </p>
      </div>
    </div>
  );
};
