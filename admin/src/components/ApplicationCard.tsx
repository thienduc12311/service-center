import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  churchApplicationDraftFrom,
  churchApplicationRequestFrom,
  churchSlugSchema,
  rejectChurchApplicationSchema,
  updateChurchApplicationSchema,
  type AdminChurchApplication,
  type ChurchApplicationDraft,
} from '@service-center/shared';
import { useApproveApplication, useRejectApplication, useUpdateApplication } from '../hooks/queries';
import { applicationLocation, changedApplicationFields, websiteHref } from '../lib/applications';
import { APPLICATION_NOT_PENDING, errorMessage, isApiErrorCode, SLUG_TAKEN } from '../lib/errors';
import { formatCount, formatDate, formatDateTime } from '../lib/format';
import { normalizeSlugInput, slugify } from '../lib/slug';
import { fieldErrorsFrom, type FieldErrors } from '../lib/validation';
import { ApplicationStatusBadge } from './status';
import { TimeZoneField } from './TimeZoneField';
import { Button, buttonClasses, Card, DetailList, ErrorNotice, Modal, Notice, TextAreaField, TextField } from './ui';

export interface ApplicationCardProps {
  application: AdminChurchApplication;
  /** Links the title to `/applications/:id` (off on that page itself). */
  linkTitle?: boolean;
  /** Reported to the page, which shows it above the list (the card may leave the list). */
  onOutcome: (outcome: ApplicationOutcome) => void;
}

/**
 * What an action on a pending application ended with. `stale`: it had already
 * been decided or withdrawn (409 `application_not_pending`).
 */
export type ApplicationOutcome =
  | { kind: 'approved'; application: AdminChurchApplication }
  | { kind: 'rejected'; application: AdminChurchApplication }
  | { kind: 'stale'; message: string };

type ApplicationAction = 'edit' | 'approve' | 'reject';

export const ApplicationCard = ({ application, linkTitle = true, onOutcome }: ApplicationCardProps) => {
  const [action, setAction] = useState<ApplicationAction | null>(null);
  const close = () => setAction(null);
  const report = (outcome: ApplicationOutcome) => {
    close();
    onOutcome(outcome);
  };

  const applicant = application.applicant_name ?? application.applicant_email ?? 'Unknown applicant';

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-app-border px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            {linkTitle ? (
              <Link to={`/applications/${application.id}`} className="hover:text-brand-700 dark:hover:text-brand-200">
                {application.church_name}
              </Link>
            ) : (
              application.church_name
            )}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {applicationLocation(application)} · submitted{' '}
            <time dateTime={application.created_at} title={formatDateTime(application.created_at)}>
              {formatDate(application.created_at)}
            </time>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationStatusBadge status={application.status} />
          {application.status === 'pending' && (
            <>
              <Button variant="ghost" size="sm" icon="pencil" onClick={() => setAction('edit')}>
                Edit details
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAction('reject')}>
                Reject
              </Button>
              <Button size="sm" icon="check" onClick={() => setAction('approve')}>
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        <DetailList
          items={[
            { label: 'Leader', value: application.leader_name },
            {
              label: 'Applicant',
              value: (
                <>
                  {applicant}
                  {application.applicant_email && application.applicant_name && (
                    <a href={`mailto:${application.applicant_email}`} className="block text-xs text-brand-700 hover:underline dark:text-brand-200">
                      {application.applicant_email}
                    </a>
                  )}
                </>
              ),
            },
            {
              label: 'Members',
              value: application.expected_member_count === null ? null : formatCount(application.expected_member_count),
            },
            {
              label: 'Website',
              value: application.website ? (
                <a href={websiteHref(application.website)} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline dark:text-brand-200">
                  {application.website}
                </a>
              ) : null,
            },
            {
              label: 'Phone',
              value: application.contact_phone ? (
                <a href={`tel:${application.contact_phone}`} className="hover:underline">
                  {application.contact_phone}
                </a>
              ) : null,
            },
            {
              label: 'Address',
              value: [application.address_line1, application.address_line2, application.postal_code].filter(Boolean).join(', '),
            },
            { label: 'Time zone', value: application.timezone },
            ...(application.reviewed_at ? [{ label: 'Decided', value: formatDateTime(application.reviewed_at) }] : []),
          ]}
        />
        {application.note && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Note from the applicant</p>
            <p className="surface-inset mt-1 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-200">{application.note}</p>
          </div>
        )}
        {application.status === 'rejected' && application.rejection_reason && (
          <Notice tone="warning" className="mt-4">
            Rejected: {application.rejection_reason}
          </Notice>
        )}
        {application.status === 'approved' && application.organization_id && (
          <div className="mt-4">
            <Link to={`/churches/${application.organization_id}`} className={buttonClasses('secondary', 'sm')}>
              Open church
            </Link>
          </div>
        )}
      </div>

      {action === 'edit' && <EditApplicationModal application={application} onClose={close} onOutcome={report} />}
      {action === 'approve' && <ApproveApplicationModal application={application} onClose={close} onOutcome={report} />}
      {action === 'reject' && <RejectApplicationModal application={application} onClose={close} onOutcome={report} />}
    </Card>
  );
};

interface ActionModalProps {
  application: AdminChurchApplication;
  onClose: () => void;
  onOutcome: (outcome: ApplicationOutcome) => void;
}

/** Shared handling for a 409 that means someone else decided first (the data is refetched by the page). */
const handleStale = (error: Error, onOutcome: (outcome: ApplicationOutcome) => void): void => {
  if (isApiErrorCode(error, APPLICATION_NOT_PENDING)) {
    onOutcome({ kind: 'stale', message: errorMessage(error, 'This application was already decided or withdrawn.') });
  }
};

/* -------------------------------------------------------------------------
 * Edit
 * ---------------------------------------------------------------------- */

type DraftField = keyof ChurchApplicationDraft;

const EditApplicationModal = ({ application, onClose, onOutcome }: ActionModalProps) => {
  const update = useUpdateApplication();
  const [draft, setDraft] = useState<ChurchApplicationDraft>(() => churchApplicationDraftFrom(application));
  const [errors, setErrors] = useState<FieldErrors>({});
  const formId = `edit-application-${application.id}`;

  const set = (field: DraftField, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const changes = changedApplicationFields(application, churchApplicationRequestFrom(draft));
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    const parsed = updateChurchApplicationSchema.safeParse(changes);
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }
    setErrors({});
    update.mutate(
      { applicationId: application.id, changes },
      { onSuccess: onClose, onError: (error) => handleStale(error, onOutcome) },
    );
  };

  const field = (name: DraftField, label: string, required = false) => (
    <TextField label={label} required={required} value={draft[name]} onChange={(event) => set(name, event.target.value)} error={errors[name]} />
  );

  return (
    <Modal
      open
      size="wide"
      title="Edit application"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">Fix the details before approving. The applicant sees the changes.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('church_name', 'Church name', true)}
          {field('leader_name', 'Leader name', true)}
          {field('contact_phone', 'Contact phone')}
          {field('website', 'Website')}
          {field('address_line1', 'Address line 1')}
          {field('address_line2', 'Address line 2')}
          {field('city', 'City', true)}
          {field('state_province', 'State / province')}
          {field('postal_code', 'Postal code')}
          {field('country', 'Country', true)}
          <TextField
            label="Member count"
            inputMode="numeric"
            value={draft.expected_member_count}
            onChange={(event) => set('expected_member_count', event.target.value)}
            error={errors.expected_member_count}
          />
          <TimeZoneField value={draft.timezone} onChange={(value) => set('timezone', value)} error={errors.timezone} />
        </div>
        <TextAreaField label="Note" value={draft.note} onChange={(event) => set('note', event.target.value)} error={errors.note} rows={3} />
        {errors[''] && <ErrorNotice error={new Error(errors[''])} />}
        <ErrorNotice error={update.error} />
      </form>
    </Modal>
  );
};

/* -------------------------------------------------------------------------
 * Approve
 * ---------------------------------------------------------------------- */

const ApproveApplicationModal = ({ application, onClose, onOutcome }: ActionModalProps) => {
  const approve = useApproveApplication();
  const [slug, setSlug] = useState(() => slugify(application.church_name));
  const [slugError, setSlugError] = useState<string | undefined>();
  const formId = `approve-application-${application.id}`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = churchSlugSchema.safeParse(slug);
    if (!parsed.success) {
      setSlugError(parsed.error.issues[0]?.message ?? 'Use 2–40 lowercase letters, numbers or dashes');
      return;
    }
    setSlugError(undefined);
    approve.mutate(
      { applicationId: application.id, slug: parsed.data },
      {
        onSuccess: (approved) => onOutcome({ kind: 'approved', application: approved }),
        onError: (error) => {
          if (isApiErrorCode(error, SLUG_TAKEN)) setSlugError(errorMessage(error));
          else handleStale(error, onOutcome);
        },
      },
    );
  };

  const serverError = approve.error && !isApiErrorCode(approve.error, SLUG_TAKEN) ? approve.error : null;

  return (
    <Modal
      open
      title={`Approve ${application.church_name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={approve.isPending}>
            Approve and create church
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This creates the church and makes {application.applicant_name ?? application.applicant_email ?? 'the applicant'} its owner.
        </p>
        <TextField
          label="URL slug"
          value={slug}
          onChange={(event) => setSlug(normalizeSlugInput(event.target.value))}
          error={slugError}
          hint="2–40 lowercase letters, numbers or dashes."
          spellCheck={false}
        />
        <ErrorNotice error={serverError} />
      </form>
    </Modal>
  );
};

/* -------------------------------------------------------------------------
 * Reject
 * ---------------------------------------------------------------------- */

const RejectApplicationModal = ({ application, onClose, onOutcome }: ActionModalProps) => {
  const reject = useRejectApplication();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const formId = `reject-application-${application.id}`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = rejectChurchApplicationSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError('Give a reason (up to 1,000 characters).');
      return;
    }
    setReasonError(undefined);
    reject.mutate(
      { applicationId: application.id, reason: parsed.data.reason },
      {
        onSuccess: (rejected) => onOutcome({ kind: 'rejected', application: rejected }),
        onError: (error) => handleStale(error, onOutcome),
      },
    );
  };

  return (
    <Modal
      open
      title={`Reject ${application.church_name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={reject.isPending}>
            Reject application
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <TextAreaField
          label="Reason"
          required
          rows={4}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
          hint="The applicant sees this reason in the app and gets it by email. They can apply again."
        />
        <ErrorNotice error={reject.error} />
      </form>
    </Modal>
  );
};
