import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Factor } from '@supabase/supabase-js';
import { AuthLayout } from '../components/AuthLayout';
import { Button, ErrorNotice, Loading, TextField } from '../components/ui';
import { supabase } from '../lib/supabase';
import {
  groupSecret,
  isCompleteTotpCode,
  normalizeTotpCode,
  qrCodeImageSource,
  unverifiedFactorIds,
  verifiedTotpFactor,
} from '../lib/mfa';
import { useAdminAuth } from '../providers/AdminAuthProvider';

export interface TwoFactorPageProps {
  userId: string;
  email: string | null;
}

/** A new authenticator-app factor waiting for its first code. */
interface TotpEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

const FRIENDLY_NAME = 'Service Center admin';

const listFactors = async (): Promise<Factor[]> => {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.all;
};

/** Remove unfinished enrollments, then start a fresh one. */
const enrollTotp = async (factors: readonly Factor[]): Promise<TotpEnrollment> => {
  for (const factorId of unverifiedFactorIds(factors)) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw error;
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: FRIENDLY_NAME });
  if (error) throw error;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
};

/** Verify a code; resolves once the session is `aal2`. */
const verifyCode = async (factorId: string, code: string): Promise<void> => {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;
  const { data, error: levelError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (levelError) throw levelError;
  if (data.currentLevel !== 'aal2') throw new Error('Two-factor login did not complete. Please try again.');
};

/**
 * Super-admin routes need two-factor login. With an authenticator app already
 * set up, this asks for a code; otherwise it walks through setting one up.
 */
export const TwoFactorPage = ({ userId, email }: TwoFactorPageProps) => {
  const { completeTwoFactor, signOut } = useAdminAuth();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);

  const factorsQuery = useQuery<Factor[]>({
    queryKey: ['mfa-factors', userId],
    queryFn: listFactors,
    staleTime: 0,
    retry: false,
  });

  const enroll = useMutation<TotpEnrollment, Error, readonly Factor[]>({
    mutationFn: enrollTotp,
    onSuccess: setEnrollment,
  });

  const verified = factorsQuery.data ? verifiedTotpFactor(factorsQuery.data) : null;
  const footer = (
    <p className="mt-6 border-t border-app-border pt-4 text-xs text-slate-500 dark:text-slate-400">
      Signed in as {email ?? 'this account'}.{' '}
      <button type="button" className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-200" onClick={() => void signOut()}>
        Use a different account
      </button>
    </p>
  );

  if (factorsQuery.isPending) {
    return (
      <AuthLayout title="Two-factor login">
        <Loading label="Checking your authenticator…" />
      </AuthLayout>
    );
  }

  if (factorsQuery.isError) {
    return (
      <AuthLayout title="Two-factor login">
        <ErrorNotice error={factorsQuery.error} onRetry={() => void factorsQuery.refetch()} />
        {footer}
      </AuthLayout>
    );
  }

  if (verified) {
    return (
      <AuthLayout title="Two-factor login" subtitle="Enter the 6-digit code from your authenticator app.">
        <CodeForm factorId={verified.id} submitLabel="Verify" onVerified={completeTwoFactor} />
        {footer}
      </AuthLayout>
    );
  }

  if (!enrollment) {
    return (
      <AuthLayout
        title="Set up two-factor login"
        subtitle="Admin access needs a code from an authenticator app (1Password, Google Authenticator, Authy and similar) every time you sign in."
      >
        <div className="space-y-4">
          <ErrorNotice error={enroll.error} />
          <Button className="w-full" loading={enroll.isPending} onClick={() => enroll.mutate(factorsQuery.data)}>
            Set up authenticator app
          </Button>
        </div>
        {footer}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set up two-factor login" subtitle="Scan this QR code with your authenticator app, then enter the code it shows.">
      <div className="space-y-4">
        <div className="flex justify-center">
          <img
            src={qrCodeImageSource(enrollment.qrCode)}
            alt="QR code for your authenticator app"
            className="size-44 rounded-xl bg-white p-2 ring-1 ring-slate-200"
          />
        </div>
        <div>
          <p className="label">Can't scan it? Enter this key instead</p>
          <code className="surface-inset block px-3 py-2 font-mono text-sm tracking-wider break-all text-slate-800 select-all dark:text-slate-100">
            {groupSecret(enrollment.secret)}
          </code>
        </div>
        <CodeForm factorId={enrollment.factorId} submitLabel="Turn on two-factor login" onVerified={completeTwoFactor} />
      </div>
      {footer}
    </AuthLayout>
  );
};

interface CodeFormProps {
  factorId: string;
  submitLabel: string;
  onVerified: () => Promise<void>;
}

const CodeForm = ({ factorId, submitLabel, onVerified }: CodeFormProps) => {
  const [code, setCode] = useState('');
  const verify = useMutation<void, Error, string>({
    mutationFn: async (value) => {
      await verifyCode(factorId, value);
      await onVerified();
    },
    onError: () => setCode(''),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCompleteTotpCode(code)) verify.mutate(code);
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <TextField
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        placeholder="123456"
        value={code}
        onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
      />
      <ErrorNotice error={verify.error} fallback="That code didn't work. Try the newest code from your app." />
      <Button type="submit" className="w-full" loading={verify.isPending} disabled={!isCompleteTotpCode(code)}>
        {submitLabel}
      </Button>
    </form>
  );
};
