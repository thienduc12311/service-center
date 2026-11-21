import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { RosterPerson, TeamWithPositions } from '@service-center/shared';
import { api } from '../../lib/api';
import { usePeople } from '../../hooks/queries';
import { Avatar, Button, ErrorNotice, IconButton, Modal } from '../ui';
import { MemberCombobox, type MemberOption } from '../settings/MemberCombobox';

export interface AddTeamMembersModalProps {
  team: TeamWithPositions;
  onClose: () => void;
  /** Called after the people were added (the caller refreshes the roster). */
  onAdded: () => Promise<unknown> | void;
}

/** Above this many positions the position chips become a select. */
const MAX_POSITION_CHIPS = 8;

/** What one Add sends: who, and which position (null = none). */
interface AddMembersRequest {
  teamId: string;
  personIds: readonly string[];
  positionId: string | null;
}

/** Why some people could not be added: the ids still queued, and the first error. */
class PartialAddError extends Error {
  constructor(
    readonly failedIds: readonly string[],
    readonly reason: unknown,
  ) {
    super(reason instanceof Error ? reason.message : String(reason));
  }
}

/** A roster person the picker may offer: has a Person record and is not archived. */
const isPickable = (person: RosterPerson): person is RosterPerson & { person_id: string } =>
  Boolean(person.person_id) && !person.archived;

const peopleAtPosition = (team: TeamWithPositions, positionId: string | null): Set<string> =>
  new Set(team.members.filter((member) => member.position_id === positionId).map((member) => member.person_id));

/**
 * Queue roster people for a position they do not already hold on this team.
 * Nothing is added until Add is pressed.
 */
export const AddTeamMembersModal = ({ team, onClose, onAdded }: AddTeamMembersModalProps) => {
  const { t } = useTranslation(['teams', 'common']);
  const people = usePeople();
  const [pickedIds, setPickedIds] = useState<readonly string[]>([]);
  const [positionId, setPositionId] = useState<string | null>(null);

  const options = useMemo<MemberOption[]>(
    () =>
      (people.data ?? []).filter(isPickable).map((person) => ({
        id: person.person_id,
        name: person.full_name ?? person.email,
        avatarUrl: person.avatar_url,
        detail: person.full_name ? person.email : null,
      })),
    [people.data],
  );
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const existing = peopleAtPosition(team, positionId);
  const queued = pickedIds.filter((id) => !existing.has(id));
  const excluded = new Set([...existing, ...queued]);

  const changePosition = (next: string | null) => {
    const nextExisting = peopleAtPosition(team, next);
    setPickedIds((current) => current.filter((id) => !nextExisting.has(id)));
    setPositionId(next);
  };

  const add = useMutation({
    mutationFn: async ({ teamId, personIds, positionId: position }: AddMembersRequest) => {
      // One at a time, so a failure part-way leaves exactly the people not yet added queued.
      for (const [index, personId] of personIds.entries()) {
        try {
          await api.addTeamMember(teamId, { person_id: personId, position_id: position });
        } catch (cause) {
          throw new PartialAddError(personIds.slice(index), cause);
        }
      }
    },
    onSuccess: async () => {
      await onAdded();
      onClose();
    },
    onError: async (error) => {
      if (error instanceof PartialAddError) {
        setPickedIds(error.failedIds);
        await onAdded();
      }
    },
  });

  const unnamed = t('common:fallback.unnamed');
  const positionName = team.positions.find((position) => position.id === positionId)?.name;

  return (
    <Modal
      open
      title={t('teamsPage.addMember.title', { team: team.name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={add.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            icon="plus"
            disabled={queued.length === 0}
            loading={add.isPending}
            onClick={() => add.mutate({ teamId: team.id, personIds: queued, positionId })}
          >
            {positionName
              ? t('teamsPage.addMember.submitAs', { count: queued.length, position: positionName })
              : t('teamsPage.addMember.submit', { count: queued.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('teamsPage.addMember.hint')}</p>

        {team.positions.length > 0 && (
          <PositionPicker team={team} value={positionId} onChange={changePosition} disabled={add.isPending} />
        )}

        <MemberCombobox
          options={options}
          value=""
          onChange={(id) => id && setPickedIds((current) => (current.includes(id) ? current : [...current, id]))}
          label={t('teamsPage.addMember.searchLabel')}
          placeholder={t('teamsPage.addMember.searchPlaceholder')}
          excludeIds={excluded}
          disabled={add.isPending}
        />

        <div>
          <p className="label">{t('teamsPage.addMember.queued', { count: queued.length })}</p>
          {queued.length === 0 ? (
            <p className="surface-inset px-3 py-2.5 text-sm text-slate-500 dark:text-slate-400">{t('teamsPage.addMember.nobodyQueued')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" aria-label={t('teamsPage.addMember.queuedLabel')}>
              {queued.map((id) => {
                const option = byId.get(id);
                const name = option?.name ?? unnamed;
                return (
                  <li
                    key={id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pr-1 pl-0.5 text-sm font-medium text-brand-800 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/15 dark:text-brand-100 dark:ring-brand-500/30"
                  >
                    <Avatar name={name} url={option?.avatarUrl} size="sm" />
                    <span className="max-w-48 truncate">{name}</span>
                    <IconButton
                      icon="close"
                      size="sm"
                      label={t('teamsPage.addMember.unqueue', { name })}
                      disabled={add.isPending}
                      onClick={() => setPickedIds((current) => current.filter((other) => other !== id))}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <ErrorNotice error={add.error instanceof PartialAddError ? add.error.reason : add.error} />
      </div>
    </Modal>
  );
};

interface PositionPickerProps {
  team: TeamWithPositions;
  value: string | null;
  onChange: (positionId: string | null) => void;
  disabled: boolean;
}

/** One position for everyone being added: chips for a short list, a select for a long one. */
const PositionPicker = ({ team, value, onChange, disabled }: PositionPickerProps) => {
  const { t } = useTranslation('teams');
  const label = t('teamsPage.addMember.position');
  if (team.positions.length > MAX_POSITION_CHIPS) {
    return (
      <label className="block">
        <span className="label">{label}</span>
        <select className="input" value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value || null)}>
          <option value="">{t('teamsPage.addMember.noPosition')}</option>
          {team.positions.map((position) => (
            <option key={position.id} value={position.id}>{position.name}</option>
          ))}
        </select>
      </label>
    );
  }
  const choices: { id: string | null; name: string }[] = [
    { id: null, name: t('teamsPage.addMember.noPosition') },
    ...team.positions.map((position) => ({ id: position.id, name: position.name })),
  ];
  return (
    <div>
      <p className="label" id={`position-label-${team.id}`}>{label}</p>
      <div role="radiogroup" aria-labelledby={`position-label-${team.id}`} className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const active = choice.id === value;
          return (
            <button
              key={choice.id ?? 'none'}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(choice.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition ${
                active
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'text-slate-600 ring-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              {choice.name}
            </button>
          );
        })}
      </div>
    </div>
  );
};
