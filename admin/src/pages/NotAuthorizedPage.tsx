import { AuthLayout } from '../components/AuthLayout';
import { Button, Notice } from '../components/ui';
import { useAdminAuth } from '../providers/AdminAuthProvider';

export interface NotAuthorizedPageProps {
  /** The account that was refused, when known. */
  email: string | null;
}

/** Shown after the API refused the account; it has already been signed out. */
export const NotAuthorizedPage = ({ email }: NotAuthorizedPageProps) => {
  const { dismissNotAuthorized } = useAdminAuth();
  return (
    <AuthLayout title="Not authorized">
      <div className="space-y-4">
        <Notice tone="warning">
          {email ? (
            <>
              <strong className="font-semibold">{email}</strong> is not a Service Center admin.
            </>
          ) : (
            'This account is not a Service Center admin.'
          )}{' '}
          You have been signed out.
        </Notice>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          To plan services and manage your church, use the Service Center app instead.
        </p>
        <Button variant="secondary" className="w-full" onClick={dismissNotAuthorized}>
          Sign in with a different account
        </Button>
      </div>
    </AuthLayout>
  );
};
