import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChurchApplicationDraft } from '@service-center/shared';
import { Button, ErrorNotice } from '../ui';

export interface ChurchApplicationFormProps {
  initial: ChurchApplicationDraft;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (draft: ChurchApplicationDraft) => void;
  onCancel?: () => void;
}

type DraftField = keyof ChurchApplicationDraft;

interface FieldSpec {
  field: DraftField;
  label: string;
  required?: boolean;
  /** Spans both columns on wider screens. */
  wide?: boolean;
  type?: 'text' | 'tel' | 'url' | 'number';
  placeholder?: string;
  autoComplete?: string;
}

/** The church details a person sends to register a church. */
export const ChurchApplicationForm = ({ initial, submitLabel, busy, error, onSubmit, onCancel }: ChurchApplicationFormProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const [draft, setDraft] = useState<ChurchApplicationDraft>(initial);
  const optional = ` (${t('churchApplication.fields.optional')})`;

  const fields: FieldSpec[] = [
    { field: 'church_name', label: t('churchApplication.fields.churchName'), required: true, wide: true, placeholder: t('churchApplication.fields.churchNamePlaceholder'), autoComplete: 'organization' },
    { field: 'leader_name', label: t('churchApplication.fields.leaderName'), required: true, autoComplete: 'name' },
    { field: 'contact_phone', label: t('churchApplication.fields.contactPhone') + optional, type: 'tel', autoComplete: 'tel' },
    { field: 'address_line1', label: t('churchApplication.fields.addressLine1') + optional, autoComplete: 'address-line1' },
    { field: 'address_line2', label: t('churchApplication.fields.addressLine2') + optional, autoComplete: 'address-line2' },
    { field: 'city', label: t('churchApplication.fields.city'), required: true, autoComplete: 'address-level2' },
    { field: 'state_province', label: t('churchApplication.fields.stateProvince') + optional, autoComplete: 'address-level1' },
    { field: 'postal_code', label: t('churchApplication.fields.postalCode') + optional, autoComplete: 'postal-code' },
    { field: 'country', label: t('churchApplication.fields.country'), required: true, autoComplete: 'country-name' },
    { field: 'website', label: t('churchApplication.fields.website') + optional, type: 'url', placeholder: 'https://' },
    { field: 'expected_member_count', label: t('churchApplication.fields.expectedMemberCount') + optional, type: 'number' },
    { field: 'timezone', label: t('churchApplication.fields.timezone'), required: true },
  ];

  const update = (field: DraftField, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(draft);
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-end">
      {fields.map((spec) => (
        <div key={spec.field} className={spec.wide ? 'sm:col-span-2' : undefined}>
          <label className="label" htmlFor={`church-application-${spec.field}`}>{spec.label}</label>
          <input
            id={`church-application-${spec.field}`}
            className="input"
            type={spec.type ?? 'text'}
            min={spec.type === 'number' ? 0 : undefined}
            value={draft[spec.field]}
            onChange={(event) => update(spec.field, event.target.value)}
            placeholder={spec.placeholder}
            autoComplete={spec.autoComplete}
            required={spec.required}
          />
        </div>
      ))}
      <div className="sm:col-span-2">
        <label className="label" htmlFor="church-application-note">{t('churchApplication.fields.note') + optional}</label>
        <textarea
          id="church-application-note"
          className="input min-h-24"
          value={draft.note}
          maxLength={2000}
          onChange={(event) => update('note', event.target.value)}
        />
      </div>

      <div className="sm:col-span-2 empty:hidden">
        <ErrorNotice error={error} />
      </div>

      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>{t('common:actions.cancel')}</Button>
        )}
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
};
