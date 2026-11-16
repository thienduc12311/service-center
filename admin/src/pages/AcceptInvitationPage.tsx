import { useState } from 'react';
import type { MyPlatformAdminInvitation } from '@service-center/shared';
import { AuthLayout } from '../components/AuthLayout';
import { Button, ErrorNotice } from '../components/ui';
import { useAdminAuth } from '../providers/AdminAuthProvider';
import { formatDateTime } from '../lib/format';

export interface AcceptInvitationPageProps {
  invitation: MyPlatformAdminInvitation;
}

/** A signed-in account with an open super-admin invitation, before it accepts. */
export const AcceptInvitationPage = ({ invitation }: AcceptInvitationPageProps) => {
  const { acceptInvitation, signOut } = useAdminAuth();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      await acceptInvitation(invitation.id);
    } catch (caught) {
      setError(caught);
      setAccepting(false);
    }
  };

  return (
    <AuthLayout title="Become a super admin">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {invitation.invited_by_name ?? 'A super admin'} invited <strong className="font-semibold">{invitation.email}</strong> to
          run Service Center. Super admins can see and change every church and account on the platform.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          After accepting you’ll set up two-factor sign-in. The invitation expires {formatDateTime(invitation.expires_at)}.
        </p>
        <ErrorNotice error={error} />
        <div className="flex flex-wrap gap-2">
          <Button loading={accepting} onClick={() => void accept()}>
            Accept invitation
          </Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Not now
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
};
