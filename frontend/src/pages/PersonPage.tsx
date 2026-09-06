import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ORG_ROLES, type CreatePersonInput, type PersonDetail } from '@service-center/shared';
import { api } from '../lib/api';
import { usePerson, useInvalidateOrg } from '../hooks/queries';
import { Button, ErrorNotice, Loading, PageHeader } from '../components/ui';

/** Editable state for the add/edit person form — a superset of `CreatePersonInput` with '' standing in for unset. */
interface PersonFormState {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  phone_carrier: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  country: string;
  campus: string;
  person_type: 'adult' | 'child';
  gender: '' | 'male' | 'female';
  birthdate: string;
  marital_status: string;
  anniversary_date: string;
  school: string;
  medical_note: string;
}

const emptyForm: PersonFormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  phone_carrier: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state_province: '',
  postal_code: '',
  country: '',
  campus: '',
  person_type: 'adult',
  gender: '',
  birthdate: '',
  marital_status: '',
  anniversary_date: '',
  school: '',
  medical_note: '',
};

const formFromDetail = (person: PersonDetail): PersonFormState => ({
  first_name: person.first_name,
  last_name: person.last_name ?? '',
  email: person.email ?? '',
  phone: person.phone ?? '',
  phone_carrier: person.phone_carrier ?? '',
  address_line1: person.address_line1 ?? '',
  address_line2: person.address_line2 ?? '',
  city: person.city ?? '',
  state_province: person.state_province ?? '',
  postal_code: person.postal_code ?? '',
  country: person.country ?? '',
  campus: person.campus ?? '',
  person_type: person.person_type,
  gender: person.gender ?? '',
  birthdate: person.birthdate ?? '',
  marital_status: person.marital_status ?? '',
  anniversary_date: person.anniversary_date ?? '',
  school: person.school ?? '',
  medical_note: person.medical_note ?? '',
});

const toInput = (form: PersonFormState): CreatePersonInput => ({
  first_name: form.first_name.trim(),
  last_name: form.last_name.trim() || null,
  email: form.email.trim() || null,
  phone: form.phone.trim() || null,
  phone_carrier: form.phone_carrier.trim() || null,
  address_line1: form.address_line1.trim() || null,
  address_line2: form.address_line2.trim() || null,
  city: form.city.trim() || null,
  state_province: form.state_province.trim() || null,
  postal_code: form.postal_code.trim() || null,
  country: form.country.trim() || null,
  campus: form.campus.trim() || null,
  person_type: form.person_type,
  gender: form.gender === '' ? null : form.gender,
  birthdate: form.birthdate || null,
  marital_status: form.marital_status.trim() || null,
  anniversary_date: form.anniversary_date || null,
  school: form.school.trim() || null,
  medical_note: form.medical_note.trim() || null,
});

const Field = ({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) => (
  <div>
    <label className="label" htmlFor={id}>
      {label}
    </label>
    {children}
  </div>
);

export const PersonPage = () => {
  const { personId } = useParams();
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const isNew = !personId;
  const person = usePerson(personId);

  const [form, setForm] = useState<PersonFormState>(emptyForm);
  const set = <K extends keyof PersonFormState>(key: K, value: PersonFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (person.data) setForm(formFromDetail(person.data));
  }, [person.data]);

  const save = useMutation({
    mutationFn: () =>
      isNew ? api.createPerson(toInput(form)) : api.updatePerson(personId!, toInput(form)),
    onSuccess: async (saved) => {
      await invalidate();
      if (isNew) navigate(`/people/${saved.id}`, { replace: true });
    },
  });

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    if (person.data) setInviteEmail(person.data.email ?? '');
  }, [person.data]);

  const invite = useMutation({
    mutationFn: () => api.invitePerson(personId!, { email: inviteEmail || undefined, role: inviteRole }),
    onSuccess: async (result) => {
      await invalidate();
      await person.refetch();
      setInviteUrl(result.invited ? result.invite_url : null);
    },
  });

  if (!isNew && person.isLoading) return <Loading />;

  const hasLogin = Boolean(person.data?.profile_id);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={isNew ? 'Add person' : (form.first_name || 'Edit person')}
        subtitle={isNew ? 'Record their profile — inviting them to create a login is a separate step.' : undefined}
      />

      <form
        className="space-y-6"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Basic</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="first-name" label="First name">
              <input
                id="first-name"
                className="input"
                value={form.first_name}
                onChange={(e) => set('first_name', e.target.value)}
                required
              />
            </Field>
            <Field id="last-name" label="Last name">
              <input id="last-name" className="input" value={form.last_name} onChange={(e) => set('last_name', e.target.value)} />
            </Field>
            <Field id="person-type" label="Type">
              <select
                id="person-type"
                className="input"
                value={form.person_type}
                onChange={(e) => set('person_type', e.target.value as 'adult' | 'child')}
              >
                <option value="adult">Adult</option>
                <option value="child">Child</option>
              </select>
            </Field>
            <Field id="gender" label="Gender">
              <select
                id="gender"
                className="input"
                value={form.gender}
                onChange={(e) => set('gender', e.target.value as PersonFormState['gender'])}
              >
                <option value="">Not set</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </Field>
            <Field id="birthdate" label="Birthdate">
              <input
                id="birthdate"
                type="date"
                className="input"
                value={form.birthdate}
                onChange={(e) => set('birthdate', e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Contact</h2>
          {hasLogin && (
            <p className="text-xs text-slate-500">
              This person already has a login — name, email and phone are managed from their own profile and shown
              here read-only.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="email" label="Email">
              <input
                id="email"
                type="email"
                className="input"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                disabled={hasLogin}
              />
            </Field>
            <Field id="phone" label="Phone">
              <input id="phone" className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} disabled={hasLogin} />
            </Field>
            <Field id="phone-carrier" label="Mobile carrier">
              <input
                id="phone-carrier"
                className="input"
                value={form.phone_carrier}
                onChange={(e) => set('phone_carrier', e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Address</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="address1" label="Address line 1">
              <input id="address1" className="input" value={form.address_line1} onChange={(e) => set('address_line1', e.target.value)} />
            </Field>
            <Field id="address2" label="Address line 2">
              <input id="address2" className="input" value={form.address_line2} onChange={(e) => set('address_line2', e.target.value)} />
            </Field>
            <Field id="city" label="City">
              <input id="city" className="input" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <Field id="state" label="State / Province">
              <input id="state" className="input" value={form.state_province} onChange={(e) => set('state_province', e.target.value)} />
            </Field>
            <Field id="postal" label="Postal code">
              <input id="postal" className="input" value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} />
            </Field>
            <Field id="country" label="Country">
              <input id="country" className="input" value={form.country} onChange={(e) => set('country', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Other</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="campus" label="Campus">
              <input id="campus" className="input" value={form.campus} onChange={(e) => set('campus', e.target.value)} />
            </Field>
            <Field id="school" label="School">
              <input id="school" className="input" value={form.school} onChange={(e) => set('school', e.target.value)} />
            </Field>
            <Field id="marital-status" label="Marital status">
              <input
                id="marital-status"
                className="input"
                value={form.marital_status}
                onChange={(e) => set('marital_status', e.target.value)}
              />
            </Field>
            <Field id="anniversary" label="Anniversary">
              <input
                id="anniversary"
                type="date"
                className="input"
                value={form.anniversary_date}
                onChange={(e) => set('anniversary_date', e.target.value)}
              />
            </Field>
          </div>
          <Field id="medical-note" label="Medical note">
            <textarea
              id="medical-note"
              className="input min-h-24"
              value={form.medical_note}
              onChange={(e) => set('medical_note', e.target.value)}
            />
          </Field>
        </section>

        <ErrorNotice error={save.error} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/people')}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            {isNew ? 'Add person' : 'Save changes'}
          </Button>
        </div>
      </form>

      {!isNew && !hasLogin && (
        <section className="card mt-6 space-y-4 p-5">
          <div>
            <h2 className="font-semibold">Invite to create a login</h2>
            <p className="mt-1 text-sm text-slate-500">
              {person.data?.pending_invitation
                ? `Invite sent to ${person.data.pending_invitation.email}, expires ${new Date(person.data.pending_invitation.expires_at).toLocaleDateString()}.`
                : 'They can respond to their own assignments and blockouts once they have a login.'}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="invite-email" label="Send to">
              <input
                id="invite-email"
                type="email"
                className="input"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </Field>
            <Field id="invite-role" label="Role">
              <select id="invite-role" className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {ORG_ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <ErrorNotice error={invite.error} />

          {inviteUrl && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
              <span>No email delivery is configured yet — share this link directly:</span>
              <code className="max-w-[16rem] truncate rounded bg-white px-2 py-1 text-xs ring-1 ring-slate-200">{inviteUrl}</code>
              <Button variant="secondary" onClick={() => navigator.clipboard.writeText(inviteUrl)}>
                Copy
              </Button>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="button" loading={invite.isPending} onClick={() => invite.mutate()} disabled={!inviteEmail}>
              {person.data?.pending_invitation ? 'Resend invite' : 'Send invite'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
};
