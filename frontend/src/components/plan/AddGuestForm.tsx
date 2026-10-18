import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RosterPerson } from '@service-center/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice } from '../ui';

export interface AddGuestFormProps {
  /** Called with the new no-login Person once created (and invited, if asked). */
  onCreated: (person: RosterPerson) => void;
  onCancel: () => void;
}

interface GuestDraft {
  firstName: string;
  lastName: string;
  email: string;
  invite: boolean;
}

const EMPTY: GuestDraft = { firstName: '', lastName: '', email: '', invite: false };

/**
 * Adds someone who has no login yet, just for staffing. They do not join a
 * team and are not invited unless an administrator ticks the separate box.
 */
export const AddGuestForm = ({ onCreated, onCancel }: AddGuestFormProps) => {
  const { isAdmin } = useAuth();
  const [draft, setDraft] = useState<GuestDraft>(EMPTY);
  const email = draft.email.trim();

  const create = useMutation({
    mutationFn: async () => {
      const person = await api.createGuest({
        first_name: draft.firstName,
        last_name: draft.lastName || null,
        email: email || null,
      });
      if (draft.invite && email) await api.invitePerson(person.id, { email });
      return { ...person, invite_pending: draft.invite && Boolean(email) };
    },
    onSuccess: (person) => {
      setDraft(EMPTY);
      onCreated(person);
    },
  });

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p className="text-sm font-medium">Someone new</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="guest-first">
            First name
          </label>
          <input
            id="guest-first"
            className="input"
            required
            maxLength={80}
            value={draft.firstName}
            onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="guest-last">
            Last name
          </label>
          <input
            id="guest-last"
            className="input"
            maxLength={80}
            value={draft.lastName}
            onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="guest-email">
          Email <span className="font-normal text-slate-500">(optional)</span>
        </label>
        <input
          id="guest-email"
          type="email"
          className="input"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value, invite: e.target.value ? draft.invite : false })}
        />
        {!email && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Without an email they can’t be notified — you’ll need to tell them yourself.
          </p>
        )}
      </div>
      {isAdmin && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300"
            disabled={!email}
            checked={draft.invite}
            onChange={(e) => setDraft({ ...draft, invite: e.target.checked })}
          />
          <span>
            Also invite them to join the organization
            <span className="block text-xs text-slate-500">
              Separate from this request. If they accept, their history stays with them.
            </span>
          </span>
        </label>
      )}
      {create.error && <ErrorNotice error={create.error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" loading={create.isPending} disabled={!draft.firstName.trim()}>
          Add and select
        </Button>
      </div>
    </form>
  );
};
