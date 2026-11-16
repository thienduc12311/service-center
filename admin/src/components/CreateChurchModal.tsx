import { useId, useState, type FormEvent } from 'react';
import { adminCreateChurchSchema, type AdminOrganizationSummary } from '@service-center/shared';
import { useCreateChurch } from '../hooks/queries';
import { createChurchRequestFrom, emptyCreateChurchDraft, type CreateChurchDraft } from '../lib/create-church';
import { isApiErrorCode, SLUG_TAKEN, errorMessage } from '../lib/errors';
import { normalizeSlugInput, slugify } from '../lib/slug';
import { browserTimeZone } from '../lib/timezones';
import { fieldErrorsFrom, type FieldErrors } from '../lib/validation';
import { TimeZoneField } from './TimeZoneField';
import { Button, ErrorNotice, Modal, TextField } from './ui';

export interface CreateChurchModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (church: AdminOrganizationSummary) => void;
}

/** Create a church directly and name its owner by email. */
export const CreateChurchModal = ({ open, onClose, onCreated }: CreateChurchModalProps) =>
  open ? <CreateChurchForm onClose={onClose} onCreated={onCreated} /> : null;

type DraftTextField = Exclude<keyof CreateChurchDraft, 'slugEdited'>;

interface CreateChurchFormProps {
  onClose: () => void;
  onCreated: (church: AdminOrganizationSummary) => void;
}

const CreateChurchForm = ({ onClose, onCreated }: CreateChurchFormProps) => {
  const formId = useId();
  const create = useCreateChurch();
  const [draft, setDraft] = useState<CreateChurchDraft>(() => emptyCreateChurchDraft(browserTimeZone()));
  const [errors, setErrors] = useState<FieldErrors>({});

  const set = (field: DraftTextField, value: string) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === 'name' && !current.slugEdited) next.slug = slugify(value);
      if (field === 'slug') next.slugEdited = true;
      return next;
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = createChurchRequestFrom(draft);
    const parsed = adminCreateChurchSchema.safeParse(request);
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error.issues));
      return;
    }
    setErrors({});
    create.mutate(request, {
      onSuccess: (church) => {
        onClose();
        onCreated(church);
      },
      onError: (error) => {
        if (isApiErrorCode(error, SLUG_TAKEN)) setErrors({ slug: errorMessage(error) });
      },
    });
  };

  const serverError = create.error && !isApiErrorCode(create.error, SLUG_TAKEN) ? create.error : null;

  return (
    <Modal
      open
      title="New church"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={create.isPending}>
            Create church
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-5">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          The owner needs a Service Center account with this email. They become the church's owner straight away.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Church name" required value={draft.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
          <TextField
            label="URL slug"
            required
            value={draft.slug}
            onChange={(e) => set('slug', normalizeSlugInput(e.target.value))}
            error={errors.slug}
            hint="2–40 lowercase letters, numbers or dashes."
            spellCheck={false}
          />
          <TextField
            label="Owner email"
            type="email"
            required
            value={draft.owner_email}
            onChange={(e) => set('owner_email', e.target.value)}
            error={errors.owner_email}
          />
          <TimeZoneField value={draft.timezone} onChange={(value) => set('timezone', value)} error={errors.timezone} />
        </div>

        <fieldset className="space-y-4">
          <legend className="section-label mb-3">Address and size (optional)</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Address line 1" value={draft.address_line1} onChange={(e) => set('address_line1', e.target.value)} error={errors.address_line1} />
            <TextField label="Address line 2" value={draft.address_line2} onChange={(e) => set('address_line2', e.target.value)} error={errors.address_line2} />
            <TextField label="City" value={draft.city} onChange={(e) => set('city', e.target.value)} error={errors.city} />
            <TextField label="State / province" value={draft.state_province} onChange={(e) => set('state_province', e.target.value)} error={errors.state_province} />
            <TextField label="Postal code" value={draft.postal_code} onChange={(e) => set('postal_code', e.target.value)} error={errors.postal_code} />
            <TextField label="Country" value={draft.country} onChange={(e) => set('country', e.target.value)} error={errors.country} />
            <TextField
              label="Member count"
              inputMode="numeric"
              value={draft.member_count}
              onChange={(e) => set('member_count', e.target.value)}
              error={errors.member_count ? 'Enter a whole number' : undefined}
            />
          </div>
        </fieldset>

        <ErrorNotice error={serverError} fallback="Could not create the church." />
      </form>
    </Modal>
  );
};
