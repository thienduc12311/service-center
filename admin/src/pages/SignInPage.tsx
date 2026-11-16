import { useState, type FormEvent } from 'react';
import { AuthLayout } from '../components/AuthLayout';
import { Button, ErrorNotice, TextField } from '../components/ui';
import { useAdminAuth } from '../providers/AdminAuthProvider';

/** Email and password only: accounts are created in the main app, admin access by SQL. */
export const SignInPage = () => {
  const { signIn } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your Service Center account. Accounts are created in the Service Center app; this site is for platform admins only."
    >
      <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <ErrorNotice error={error} fallback="Could not sign in. Check your email and password." />
        <Button type="submit" className="w-full" loading={submitting} disabled={!email.trim() || !password}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
};
