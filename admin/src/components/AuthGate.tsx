import { Outlet } from 'react-router-dom';
import { useAdminAuth } from '../providers/AdminAuthProvider';
import { SignInPage } from '../pages/SignInPage';
import { TwoFactorPage } from '../pages/TwoFactorPage';
import { NotAuthorizedPage } from '../pages/NotAuthorizedPage';
import { AcceptInvitationPage } from '../pages/AcceptInvitationPage';
import { AuthLayout } from './AuthLayout';
import { Button, ErrorNotice, Loading } from './ui';

/** Renders the dashboard only for a super admin who completed two-factor login. */
export const AuthGate = () => {
  const { stage, retry, signOut } = useAdminAuth();
  switch (stage.kind) {
    case 'loading':
      return (
        <div className="grid min-h-full place-items-center">
          <Loading label="Checking your session…" />
        </div>
      );
    case 'signed_out':
      return <SignInPage />;
    case 'not_authorized':
      return <NotAuthorizedPage email={stage.email} />;
    case 'invited':
      return <AcceptInvitationPage invitation={stage.invitation} />;
    case 'two_factor':
      return <TwoFactorPage key={stage.session.user.id} userId={stage.session.user.id} email={stage.adminSession.email} />;
    case 'error':
      return (
        <AuthLayout title="Could not load your admin session">
          <div className="space-y-4">
            <ErrorNotice error={stage.error} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={retry}>Try again</Button>
              <Button variant="secondary" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        </AuthLayout>
      );
    case 'ready':
      return <Outlet />;
  }
};
