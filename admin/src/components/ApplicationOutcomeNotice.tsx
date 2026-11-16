import { Link } from 'react-router-dom';
import type { ApplicationOutcome } from './ApplicationCard';
import { Notice } from './ui';

export interface ApplicationOutcomeNoticeProps {
  outcome: ApplicationOutcome | null;
  onDismiss: () => void;
}

/** The result of the last approve/reject, or why an action was refused. */
export const ApplicationOutcomeNotice = ({ outcome, onDismiss }: ApplicationOutcomeNoticeProps) => {
  if (!outcome) return null;
  const dismiss = (
    <button type="button" onClick={onDismiss} className="ml-2 font-medium underline underline-offset-2">
      Dismiss
    </button>
  );
  switch (outcome.kind) {
    case 'approved': {
      const { application } = outcome;
      return (
        <Notice tone="success" className="mb-4">
          Approved <strong className="font-semibold">{application.church_name}</strong>. The church was created and{' '}
          {application.applicant_name ?? application.applicant_email ?? 'the applicant'} is its owner; they have been emailed.{' '}
          {application.organization_id && (
            <Link to={`/churches/${application.organization_id}`} className="font-medium underline underline-offset-2">
              Open church
            </Link>
          )}
          {dismiss}
        </Notice>
      );
    }
    case 'rejected':
      return (
        <Notice tone="success" className="mb-4">
          Rejected <strong className="font-semibold">{outcome.application.church_name}</strong>. The applicant has been emailed the reason.
          {dismiss}
        </Notice>
      );
    case 'stale':
      return (
        <Notice tone="warning" className="mb-4">
          {outcome.message} The list has been refreshed.
          {dismiss}
        </Notice>
      );
  }
};
